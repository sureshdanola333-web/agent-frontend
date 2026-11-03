"use strict";
require("dotenv").config();
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const Anthropic = require("@anthropic-ai/sdk");

/* ---------- Configuration (all from environment variables) ---------- */
const PORT = parseInt(process.env.PORT || "3000", 10);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "1500", 10);
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE || "20", 10);
const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const KEY_MISSING = !API_KEY || API_KEY === "your-key-here";

// The API key lives only on the server. It is never sent to the browser.
const client = KEY_MISSING ? null : new Anthropic({ apiKey: API_KEY });

// The system prompt is kept on the server so the browser cannot change the agent's role.
const SYSTEM_PROMPT = [
  "You are the AI Marketing Agent for WALL PAINTS, a painting and interior finishing business in Hyderabad, India.",
  "Services: interior painting, exterior painting, house painting, apartment painting, office painting and premium wall finishes.",
  "Customers: homeowners, apartments, builders, offices, commercial properties and interior designers.",
  "Goal: more painting orders and leads (phone call, WhatsApp, free site visit and estimate).",
  "You create Facebook and Instagram posts, captions, hashtags, ad concepts, video ad prompts, festival offers, marketing plans and lead strategies.",
  "Write practical, ready-to-use output in simple English (you may add one Telugu or Hindi line when it helps).",
  "Use Hyderabad context: areas, festivals and weather. Never invent prices, discounts, awards or claims; use [placeholders] instead.",
  "Keep answers concise and well structured. Stay on the topic of marketing and growing the painting business."
].join("\n");

/* ---------- Helpers ---------- */
function explain(err) {
  const s = err && err.status;
  if (s === 401) return "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY in your .env file.";
  if (s === 403) return "This API key is not allowed to use that model or feature (403).";
  if (s === 404) return `Model "${MODEL}" was not found. Set a valid ANTHROPIC_MODEL in your .env file.`;
  if (s === 429) return "Anthropic rate limit reached. Wait a moment and try again.";
  if (s === 400 && /credit|billing/i.test(err.message || "")) return "Your Anthropic account has no credit. Add billing in the Anthropic Console.";
  if (s >= 500) return "Anthropic is having a temporary problem. Please try again shortly.";
  if (err && /connection|fetch|network|ENOTFOUND|ECONN|ETIMEDOUT/i.test(`${err.name} ${err.message}`))
    return "The server cannot reach api.anthropic.com. Check your internet connection or firewall.";
  return (err && err.message) || "Unknown error.";
}

// Checks the key + model with a free "retrieve model" call (no tokens used). Cached for 30 s.
let cache = { at: 0, val: null };
async function getStatus() {
  if (!client) return { connected: false, model: MODEL, reason: "ANTHROPIC_API_KEY is missing. Add it to your .env file and restart the server." };
  if (cache.val && Date.now() - cache.at < 30000) return cache.val;
  let val;
  try {
    await client.models.retrieve(MODEL);
    val = { connected: true, model: MODEL, reason: "" };
  } catch (e) {
    val = { connected: false, model: MODEL, reason: explain(e) };
  }
  cache = { at: Date.now(), val };
  return val;
}

// Validates and tidies the chat history sent by the browser.
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) return null;
  const out = [];
  for (const m of input) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string") return null;
    const text = m.content.trim().slice(0, 6000);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + text;
    else out.push({ role: m.role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out.length && out[out.length - 1].role === "user" ? out : null;
}

/* ---------- App ---------- */
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." }
});

// Tells the dashboard whether to show "AI Connected" or "AI Disconnected".
app.get("/api/status", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await getStatus());
});

// Streams Claude's reply to the browser as Server-Sent Events.
app.post("/api/chat", limiter, async (req, res) => {
  const status = await getStatus();
  if (!status.connected) return res.status(503).json({ error: "AI is disconnected: " + status.reason });

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: "Invalid request: send messages that end with a user message." });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ctrl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctrl.abort(); });

  try {
    const stream = client.messages.stream(
      { model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages },
      { signal: ctrl.signal }
    );
    stream.on("text", (t) => send({ delta: t }));
    await stream.finalMessage();
    send({ done: true });
  } catch (e) {
    if (!ctrl.signal.aborted) {
      cache.at = 0; // re-check the connection on the next status call
      console.error("Anthropic error:", e && e.status, e && e.message);
      send({ error: explain(e) });
    }
  }
  res.end();
});

app.listen(PORT, async () => {
  console.log(`WALL PAINTS AI Marketing Agent running at http://localhost:${PORT}`);
  const s = await getStatus();
  console.log(s.connected ? `AI Connected (model: ${s.model})` : `AI Disconnected - ${s.reason}`);
});

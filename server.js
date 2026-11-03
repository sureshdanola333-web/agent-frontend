"use strict";
const fs = require("fs");
const path = require("path");

// Load .env from the project folder (not from wherever the terminal happens to be).
const ENV_FILE = path.join(__dirname, ".env");
require("dotenv").config({ path: ENV_FILE, quiet: true });

const express = require("express");
const rateLimit = require("express-rate-limit");
const { getStatus, route, explain } = require("./providers");

/* ---------- Configuration (environment variables) ---------- */
const PORT = parseInt(process.env.PORT || "3000", 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "1500", 10);
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE || "20", 10);
const TASKS = ["chat", "content", "ads", "growth", "plan"];

// The system prompt lives on the server so the browser cannot change the agent's role.
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

// Tells the dashboard whether to show "AI Connected" or "AI Disconnected" (and which providers work).
app.get("/api/status", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const { connected, mode, model, reason, providers } = await getStatus();
  res.json({ connected, mode, model, reason, providers });
});

// Streams the AI reply to the browser as Server-Sent Events. Provider + model are chosen automatically.
app.post("/api/chat", limiter, async (req, res) => {
  const status = await getStatus();
  if (!status.connected) return res.status(503).json({ error: "AI is disconnected: " + status.reason });

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: "Invalid request: send messages that end with a user message." });
  const task = TASKS.includes(req.body.task) ? req.body.task : "chat";

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
    await route({
      task, messages, system: SYSTEM_PROMPT, maxTokens: MAX_TOKENS, signal: ctrl.signal,
      onMeta: (m) => send(m),
      onText: (t) => send({ delta: t })
    });
    send({ done: true });
  } catch (e) {
    if (!ctrl.signal.aborted) send({ error: explain(e) });
  }
  res.end();
});

/* ---------- Start ---------- */
const server = app.listen(PORT, async () => {
  console.log(`\nWALL PAINTS AI Marketing Agent  →  http://localhost:${PORT}`);
  if (!fs.existsSync(ENV_FILE)) console.log("Note: no .env file found. Copy .env.example to .env and add at least one API key.");
  const s = await getStatus(true);
  for (const p of s.providers) {
    console.log(`  ${p.ok ? "✔" : "✘"} ${p.label.padEnd(18)} ${p.ok ? "connected" : p.configured ? p.reason : "no key set"}`);
  }
  console.log(s.connected ? "AI Connected\n" : `AI Disconnected - ${s.reason}\n`);
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`\nPort ${PORT} is already in use. Close the other server, or set PORT=3001 in .env and run npm start again.\n`);
  else console.error("\nServer error:", e.message, "\n");
  process.exit(1);
});
process.on("unhandledRejection", (e) => console.error("Unhandled error:", e && e.message));

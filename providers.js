"use strict";
/**
 * Provider layer: Anthropic Claude, OpenAI GPT and Google Gemini behind ONE interface.
 * Each provider exposes: { id, label, apiKey, models:{fast,smart}, check(model), stream({...}) }.
 * To add another provider later, add one object to PROVIDERS and put its id in the priority lists.
 */
const Anthropic = require("@anthropic-ai/sdk");
const env = process.env;

/* ---------- small helpers ---------- */
const clean = (v) => {
  v = (v || "").trim();
  return !v || /^(your-|paste-)|-here$/i.test(v) ? "" : v;
};
function httpError(provider, status, body) {
  const e = new Error(`${provider} returned ${status}: ${String(body).slice(0, 300)}`);
  e.status = status;
  return e;
}
async function* sseData(res) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      const ev = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (data) yield data;
    }
  }
}
async function getJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw httpError("API", r.status, await r.text());
  return r.json();
}

/** Turns any provider error into a short, human-friendly reason. */
function explain(err, label = "The AI provider") {
  const s = err && err.status;
  if (s === 401) return `${label} rejected the API key (401). Check the key in your .env file.`;
  if (s === 403) return `${label} refused the request (403). The key may not have access to this model.`;
  if (s === 404) return `${label}: model not found (404). Set a valid model name in your .env file.`;
  if (s === 429) return `${label}: rate limit or quota reached (429). Wait a moment, or add credit / use another provider.`;
  if (s === 400 && /credit|billing/i.test((err && err.message) || "")) return `${label}: the account has no credit. Add billing, or use another provider.`;
  if (s >= 500) return `${label} is having a temporary problem (${s}). Try again shortly.`;
  if (err && /abort|timeout/i.test(`${err.name} ${err.message}`)) return `${label} did not answer in time.`;
  if (err && /connection|fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(`${err.name} ${err.message} ${err.cause || ""}`))
    return `Cannot reach ${label}. Check your internet connection, VPN or firewall.`;
  return (err && err.message) || "Unknown error.";
}

/* ---------- Provider: Anthropic Claude ---------- */
const anthropic = {
  id: "anthropic",
  label: "Anthropic Claude",
  apiKey: clean(env.ANTHROPIC_API_KEY),
  models: {
    smart: env.ANTHROPIC_MODEL_SMART || env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    fast: env.ANTHROPIC_MODEL_FAST || "claude-haiku-5-5"
  },
  _client: null,
  client() {
    return (this._client ||= new Anthropic({ apiKey: this.apiKey })); // honours ANTHROPIC_BASE_URL
  },
  async check(model) {
    await this.client().models.retrieve(model);
  },
  async stream({ model, system, messages, maxTokens, signal, onText }) {
    const s = this.client().messages.stream({ model, max_tokens: maxTokens, system, messages }, { signal });
    s.on("text", onText);
    await s.finalMessage();
  }
};

/* ---------- Provider: OpenAI GPT ---------- */
const openai = {
  id: "openai",
  label: "OpenAI GPT",
  apiKey: clean(env.OPENAI_API_KEY),
  base: (env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, ""),
  models: {
    smart: env.OPENAI_MODEL_SMART || env.OPENAI_MODEL || "gpt-5",
    fast: env.OPENAI_MODEL_FAST || "gpt-5-mini"
  },
  headers() {
    return { Authorization: `Bearer ${this.apiKey}` };
  },
  async check(model) {
    await getJson(`${this.base}/v1/models/${encodeURIComponent(model)}`, this.headers());
  },
  async stream({ model, system, messages, maxTokens, signal, onText }) {
    const res = await fetch(`${this.base}/v1/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        max_completion_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages]
      }),
      signal
    });
    if (!res.ok) throw httpError("OpenAI", res.status, await res.text());
    for await (const data of sseData(res)) {
      if (data === "[DONE]") break;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw httpError("OpenAI", j.error.code || 500, j.error.message);
      const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
      if (t) onText(t);
    }
  }
};

/* ---------- Provider: Google Gemini ---------- */
const gemini = {
  id: "gemini",
  label: "Google Gemini",
  apiKey: clean(env.GEMINI_API_KEY) || clean(env.GOOGLE_API_KEY),
  base: (env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, ""),
  models: {
    smart: env.GEMINI_MODEL_SMART || env.GEMINI_MODEL || "gemini-3.1-flash-lite",
    fast: env.GEMINI_MODEL_FAST || "gemini-3.1-flash-lite"
  },
  headers() {
    return { "x-goog-api-key": this.apiKey };
  },
  async check(model) {
    await getJson(`${this.base}/v1beta/models/${encodeURIComponent(model)}`, this.headers());
  },
  async stream({ model, system, messages, maxTokens, signal, onText }) {
    const res = await fetch(`${this.base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens }
      }),
      signal
    });
    if (!res.ok) throw httpError("Gemini", res.status, await res.text());
    for await (const data of sseData(res)) {
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw httpError("Gemini", j.error.code || 500, j.error.message);
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      for (const p of parts) if (p.text && !p.thought) onText(p.text);
    }
  }
};

const PROVIDERS = { anthropic, openai, gemini };

/* ---------- Routing settings ---------- */
const list = (v, d) => (v || d).split(",").map((s) => s.trim().toLowerCase()).filter((s) => PROVIDERS[s]);
const FORCED = (env.AI_PROVIDER || "auto").trim().toLowerCase(); // auto | anthropic | openai | gemini
// Hard / long tasks: best quality first. Light tasks: cheapest (Gemini free tier) first.
const ORDER_SMART = list(env.AI_PRIORITY_SMART, "anthropic,openai,gemini");
const ORDER_FAST = list(env.AI_PRIORITY_FAST, "gemini,openai,anthropic");

/* ---------- Health check (cached 30 s, uses free "get model" calls, no tokens) ---------- */
let cache = { at: 0, val: null };
async function checkProvider(p) {
  if (!p.apiKey) return { id: p.id, label: p.label, configured: false, ok: false, reason: "No API key set.", models: {} };
  const models = {};
  let lastReason = "";
  await Promise.all(
    [...new Set([p.models.fast, p.models.smart])].map(async (m) => {
      try { await p.check(m); models[m] = { ok: true }; }
      catch (e) { lastReason = explain(e, p.label); models[m] = { ok: false, reason: lastReason }; }
    })
  );
  const ok = Object.values(models).some((m) => m.ok);
  return { id: p.id, label: p.label, configured: true, ok, reason: ok ? "" : lastReason, tiers: p.models, models };
}
async function getStatus(force = false) {
  if (!force && cache.val && Date.now() - cache.at < 30000) return cache.val;
  const providers = await Promise.all(Object.values(PROVIDERS).map(checkProvider));
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
  const connected = providers.some((p) => p.ok);
  let reason = "";
  if (!connected) {
    const configured = providers.filter((p) => p.configured);
    reason = configured.length
      ? configured.map((p) => `${p.label}: ${p.reason}`).join(" ")
      : "No API key found. Add at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY to your .env file, then restart with: npm start";
  }
  const first = providers.find((p) => p.ok);
  cache = { at: Date.now(), val: { connected, mode: FORCED, model: first ? first.tiers.smart : "", reason, providers, byId } };
  return cache.val;
}

/* ---------- Automatic model selection ---------- */
function pickTier(task, messages) {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return task === "plan" || task === "growth" || chars > 900 || messages.length >= 6 ? "smart" : "fast";
}
function modelFor(p, tier) {
  const want = p.tiers[tier], other = p.tiers[tier === "smart" ? "fast" : "smart"];
  if (p.models[want] && p.models[want].ok) return want;
  return p.models[other] && p.models[other].ok ? other : null;
}
function candidates(st, tier) {
  const order = FORCED !== "auto" && PROVIDERS[FORCED] ? [FORCED] : tier === "smart" ? ORDER_SMART : ORDER_FAST;
  return order.map((id) => st.byId[id]).filter((p) => p && p.ok).map((p) => ({ p, model: modelFor(p, tier) })).filter((c) => c.model);
}

/** Picks provider + model, streams the answer, and fails over to the next provider if one fails before answering. */
async function route({ task, messages, system, maxTokens, signal, onMeta, onText }) {
  const st = await getStatus();
  const tier = pickTier(task, messages);
  const list = candidates(st, tier);
  if (!list.length) {
    const e = new Error("No AI provider is connected. " + st.reason);
    e.status = 503;
    throw e;
  }
  let lastErr;
  for (const { p, model } of list) {
    let started = false;
    try {
      onMeta({ provider: p.id, label: p.label, model, tier });
      await PROVIDERS[p.id].stream({ model, system, messages, maxTokens, signal, onText: (t) => { started = true; onText(t); } });
      return;
    } catch (e) {
      if (signal.aborted) throw e;
      lastErr = e;
      cache.at = 0; // re-check health on the next status call
      console.error(`[${p.id}] ${e.status || ""} ${e.message}`);
      if (started) throw e; // cannot switch provider mid-answer
    }
  }
  throw lastErr;
}

module.exports = { PROVIDERS, getStatus, route, explain, FORCED };

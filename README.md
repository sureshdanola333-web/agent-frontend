# WALL PAINTS AI Marketing Agent

A marketing dashboard (chat, Facebook/Instagram content, ads, growth ideas, leads, planner) connected to
**Anthropic Claude, OpenAI GPT and Google Gemini** through one secure **Node.js** backend.
The server picks the best provider and model automatically. API keys stay on the server in `.env`.

## Run it (5 steps)
You need **Node.js 18 or newer** (https://nodejs.org, LTS version). Check with `node -v`.

1. Unzip and open a terminal **inside the `wall-paints-ai-agent` folder** (the one containing `package.json`).
2. `npm install`
3. Create your settings file: Mac/Linux `cp .env.example .env` · Windows `copy .env.example .env`
4. Open `.env` and replace `your-key-here` for **at least one** provider (see "API keys" below).
5. `npm start`, then open **http://localhost:3000**

The terminal shows one line per provider (✔ connected / ✘ reason) and ends with `AI Connected`.
After editing `.env`, press Ctrl+C and run `npm start` again.

## "AI Disconnected – Cannot reach the backend. Start it with npm start"
This message comes from the page itself: the page loaded, but the server is not answering. Check in this order:
1. **You opened `public/index.html` by double-clicking it.** The page must be opened from the server: run `npm start`, then use http://localhost:3000.
2. **`npm start` was never run, or the terminal was closed.** Keep the terminal window open while you use the app.
3. **Wrong folder.** `npm start` must be run in the folder that contains `package.json` (error: `Missing script: "start"` or `ENOENT package.json`).
4. **`npm install` was skipped.** Error: `Cannot find module 'express'`. Run `npm install`.
5. **Node.js is too old.** Run `node -v`; it must be 18 or higher.
6. **Port already in use.** The server says so. Set `PORT=3001` in `.env` and open http://localhost:3001.

If the page loads from http://localhost:3000 but says **AI Disconnected** with a reason in the banner, the server is running and the problem is your API key (see below).

## API keys (you need at least one)
| Provider | Key name in `.env` | Get it at | Cost |
|---|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | https://aistudio.google.com → Get API key | Has a free tier with rate limits (no billing needed to start). Google's terms say free-tier prompts may be used to improve their products, so avoid confidential customer data. |
| Anthropic Claude | `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys | Pay-as-you-go prepaid credit |
| OpenAI GPT | `OPENAI_API_KEY` | https://platform.openai.com → API keys | Pay-as-you-go prepaid credit |

Notes: API keys are separate from chat subscriptions (Claude.ai, ChatGPT). A subscription does not include API access.
To try this at no cost, use just a Gemini key. Free-tier limits and model availability can change, so check Google's current rules.

## Automatic model selection
Each request is sent with a task type (`chat`, `content`, `ads`, `growth`, `plan`). The server then:
1. Checks which providers are connected (keys and models are verified at startup and every 30 s; no tokens are used).
2. Chooses a **tier**: *smart* for `plan` / `growth` tasks, long prompts (900+ characters) or long conversations; otherwise *fast*.
3. Tries providers in order: **smart** → `AI_PRIORITY_SMART` (default Claude, GPT, Gemini); **fast** → `AI_PRIORITY_FAST` (default Gemini, GPT, Claude, cheapest first).
4. Uses that provider's model for the tier (`*_MODEL_SMART` / `*_MODEL_FAST`). If one model name is invalid, it uses the provider's other model.
5. **Fails over** to the next connected provider if one fails before answering (rate limit, quota, outage).

Set `AI_PROVIDER=anthropic` (or `openai` / `gemini`) in `.env` to force a single provider.
Hover over the **AI Connected** badge to see which provider and model answered last.
Model names change over time. If a provider shows "model not found", set a current model name in `.env`.

## Files
```
wall-paints-ai-agent/
├── server.js        Express server: /api/status, /api/chat (streaming), serves the website
├── providers.js     Claude + OpenAI + Gemini adapters, health checks, automatic selection, failover
├── package.json     Dependencies and npm scripts (start, dev)
├── .env.example     Settings template (copy to .env)
└── public/index.html  Your dashboard (design unchanged)
```
To add another provider later, add one adapter object (`check`, `stream`) to `PROVIDERS` in `providers.js`.

## API contract (for connecting any front end)
- `GET /api/status` → `{ connected, mode, model, reason, providers:[{id,label,configured,ok,reason}] }`
- `POST /api/chat` with `{ "task": "content", "messages": [{ "role": "user", "content": "..." }] }` streams Server-Sent Events:
  `data: {"provider","model","tier"}` (who is answering), `data: {"delta":"text"}` (repeated), then `data: {"done":true}` or `data: {"error":"..."}`.

## Security
- Never put API keys in `public/` or in front-end JavaScript. Keep `.env` private (already in `.gitignore`).
- The server limits request size and requests per minute, and validates all input.
- Add a login before putting this on the internet; anyone who can open the site can spend your API credit.
- Automatic posting to Facebook/Instagram is not connected yet (`Integrations` in `public/index.html` marks the spot).

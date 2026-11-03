# WALL PAINTS AI Marketing Agent

A marketing dashboard (chat, Facebook/Instagram content, ads, growth ideas, leads, planner)
connected to the real **Anthropic Claude API** through a small, secure **Node.js** backend.

The API key stays on the server in `.env`. The browser never sees it.

## What you need
- **Node.js 18 or newer** (https://nodejs.org – choose the LTS version). Check with `node -v`.
- An **Anthropic API key** from https://console.anthropic.com (Settings → API Keys). The account needs billing credit.

## Run it locally (5 steps)
1. Unzip the project and open a terminal in the folder (`wall-paints-ai-agent`).
2. Install the packages:
   ```
   npm install
   ```
3. Create your settings file.
   - Mac / Linux: `cp .env.example .env`
   - Windows (Command Prompt): `copy .env.example .env`
4. Open `.env` in any text editor and replace `your-key-here` with your real key:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
5. Start the server:
   ```
   npm start
   ```
   Open **http://localhost:3000** in your browser.

The terminal prints `AI Connected (model: ...)` when everything works.
After changing `.env`, stop the server (Ctrl+C) and run `npm start` again.
Use `npm run dev` to restart automatically when you edit `server.js`.

## AI Connected / AI Disconnected
The badge at the top right of every page shows the real connection state. It is checked when the page
opens and every 30 seconds. When it says **AI Disconnected**, a banner under the title explains why:

| Message | Fix |
|---|---|
| ANTHROPIC_API_KEY is missing | Create `.env` and add your key (step 3–4), then restart |
| Anthropic rejected the API key (401) | The key is wrong, revoked or has extra spaces. Paste it again |
| Model "…" was not found | Set a valid `ANTHROPIC_MODEL` in `.env` |
| Your account has no credit | Add billing in the Anthropic Console |
| Cannot reach api.anthropic.com | Check internet, VPN or firewall |
| Cannot reach the backend | The server is not running. Run `npm start` |

## Settings (`.env`)
| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Your secret key (required) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Claude model used for all replies |
| `PORT` | `3000` | Port for the website |
| `MAX_TOKENS` | `1500` | Maximum length of one reply |
| `RATE_LIMIT_PER_MINUTE` | `20` | Requests per minute per visitor (protects your credit) |

## Project files
```
wall-paints-ai-agent/
├── server.js          Express backend: /api/status, /api/chat (streaming), serves the website
├── package.json       Dependencies and npm scripts
├── .env.example       Template for your settings (copy to .env)
├── .gitignore         Keeps .env and node_modules out of Git
└── public/
    └── index.html     Your dashboard (HTML + CSS + JS in one file)
```

## How the connection works
- `GET /api/status` → `{ connected, model, reason }` (the key and model are verified with Anthropic; no tokens used).
- `POST /api/chat` with `{ "messages": [{ "role": "user", "content": "..." }] }` → streams Claude's reply as
  Server-Sent Events: `data: {"delta":"text"}` … `data: {"done":true}` (or `data: {"error":"..."}`).
- The WALL PAINTS system prompt (Hyderabad painting business, no invented prices) lives in `server.js`.
  Edit `SYSTEM_PROMPT` there to change how the agent behaves.
- All dashboard tools (Content, Ads, Growth, Planner, Chat) use the same `/api/chat` endpoint.

## Use it with your own existing HTML/CSS/JS site
Copy your files into `public/` and call the same two endpoints from your JavaScript. See the `AI` object
in `public/index.html` for a complete, working example (status check, streaming reader, error handling).

## Security notes
- Never put the API key in any file inside `public/` or in front-end JavaScript.
- Keep `.env` private. It is already listed in `.gitignore`.
- The server limits request size and requests per minute, and validates every message.
- Before putting this on the internet, add a login (or keep it private), because anyone who can open the site can spend your API credit.

## Facebook / Instagram posting (next step)
Generating content works now. Automatic posting is not connected yet. `Integrations` in `public/index.html`
marks where to add Meta Graph API calls later (do those on the server too, with tokens in `.env`).

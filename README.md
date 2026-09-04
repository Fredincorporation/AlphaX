# AlphaX

AlphaX is a human-supervised WebMCP mediation layer. It inspects websites, proposes structured tools, and executes approved actions — powered entirely by Cloudflare Workers.

## What It Does

1. Analyze a target URL — via zero-quota static fetch first, falling back to Cloudflare Browser Rendering for JS-heavy pages.
2. Inspect the page DOM, forms, links, headings, and interactive controls.
3. Generate WebMCP tool proposals with JSON Schema inputs (Groq, Gemini, or the built-in heuristic generator).
4. Review, edit, approve, or reject proposed tools.
5. Execute approved tool recipes through Browser Rendering with human supervision and execution logging.
6. Store tools and execution history in Cloudflare D1; cache analyses and screenshots in Workers KV.
7. Register approved tools through `document.modelContext`, `window.modelContext`, and `navigator.modelContext`.

## Architecture

```text
Browser UI (Vercel)
  | REST and WebSocket
  v
Cloudflare Worker
  |-- Static analyzer (fetch + HTMLRewriter, zero browser quota)
  |-- Browser Rendering -> target website (JS-heavy pages, live screenshots)
  |-- KV cache -> analyses (24h), screenshots (4min), request dedupe
  |-- Durable Objects -> sessions, WebSockets, confirmations
  |-- LLMToolGenerator -> GroqCloud, Gemini, or heuristics
  |-- D1 -> tools and audit history
  v
WebMCP Bridge -> document.modelContext / window.modelContext / navigator.modelContext
```

### Quota-saving pipeline

Cloudflare's free Browser Rendering tier has strict daily and concurrency limits, so every browser launch is preceded by cheaper layers:

1. **Request dedupe** — identical analyze/execute calls within ~45s get a `429` instead of a new browser session.
2. **Analysis cache** (KV, 24h TTL) — repeat visits to the same domain skip both the render and the LLM generation pass.
3. **Static analysis** — server-rendered sites are parsed with `fetch()` + HTMLRewriter at zero browser quota; only JS-rendered shells or bot-challenged pages fall through to Browser Rendering.
4. **Screenshot cache** (KV, 4 min TTL) — the visual output stays near-real-time without re-rendering. Pass `"forceLive": true` to `/api/analyze` for a guaranteed fresh screenshot, or `"forceRegenerate": true` to bypass the analysis cache.

The analyze response reports which path fired via `analysisSource`: `cache`, `static`, or `browser`.

## Requirements

- Node.js and npm for local development
- Cloudflare account with Browser Rendering enabled
- D1 database and Durable Objects namespace
- Optional GroqCloud or Gemini API key

## Install

```bash
git clone https://github.com/Fredincorporation/AlphaX.git
cd AlphaX
npm install
```

Cloudflare supplies the browser runtime; this project does not download local Chromium during installation.

## Configuration

Create a `.env` file when you need server-side or frontend configuration. All provider keys are optional.

For local development, create a `.env` file that points the frontend at the Worker, which `wrangler dev` serves on port 8787 by default:

```dotenv
# File: .env
VITE_API_URL=http://localhost:8787
VITE_WS_URL=ws://localhost:8787
```

> **Important:** Vite proxies same-origin `/api` and `/ws` requests to `http://localhost:3001`. If anything else is already listening on port 3001 (e.g. another project's dev server), it will silently intercept AlphaX traffic and features such as the Real-Time Action Log will show no results. Using `VITE_API_URL`/`VITE_WS_URL` against port 8787 avoids this conflict.

For deployments, override the same variables with your backend URLs:

```env
# Frontend-to-backend URLs for a separately deployed frontend
VITE_API_URL=https://your-backend.example.com
VITE_WS_URL=wss://your-backend.example.com
```

Worker secrets are optional and configured with Wrangler, not `.env`:

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
```

Create the D1 database and apply migrations locally and remotely:

```bash
npx wrangler d1 migrations apply alphax --local
npx wrangler d1 migrations apply alphax --remote
```

## Run Locally

Apply local D1 migrations, then run the Cloudflare backend (serves on `http://localhost:8787`):

```bash
npx wrangler d1 migrations apply alphax --local
npm run dev
```

Make sure the `.env` from the Configuration section exists so the frontend connects to port 8787.

Run the Vite frontend in a second terminal:

```bash
npm run dev:frontend
```

Open `http://localhost:5173`.

Useful local endpoints:

- `GET /api/health` - Worker health and runtime information
- `GET /api/samples` - available sample targets
- `POST /api/analyze` - navigate, analyze, and generate tools
- `GET /api/tools` - list stored tools
- `POST /api/tools/execute` - execute a tool recipe
- `GET /api/history` - execution history
- `ws://localhost:8787/ws?sessionId=...` - live status, execution log, and confirmation events

## Cloudflare Deployment

```bash
npm run typecheck
npm test
npm run build:worker
npx wrangler d1 migrations apply alphax --remote
npm run deploy:worker
```

One-time setup: create the KV namespace used by the cache layer and paste its `id` into `wrangler.jsonc`:

```bash
npx wrangler kv namespace create CACHE
```

Set `database_id` in `wrangler.jsonc`, configure `ALLOWED_ORIGIN` to the Vercel origin, and set Vercel's `VITE_API_URL` and `VITE_WS_URL` to the Worker hostname.

## Supervision Modes

- **Strict**: every tool execution requires human approval.
- **Supervised**: read-only tools run automatically; writes and sensitive actions require approval.
- **Autonomous**: actions run without an approval prompt, but remain logged.

Tool execution is serialized within a session so simultaneous calls cannot navigate or modify the page at the same time.

## Target-Site Limitations

AlphaX cannot bypass anti-bot systems, CAPTCHA pages, login walls, or automation challenges. Amazon, eBay, YouTube, and other services may redirect Chromium to a challenge page or crash/close the automated page. AlphaX reports these states in the browser panel and error notifications; opening a popup does not bypass the challenge.

Some sites also change their DOM frequently. Generated selectors are best-effort and may require review or editing in the Tool Review panel before approval.

## Included Targets

Prebuilt recipes are included for:

- Hacker News
- Wikipedia
- GitHub
- Quotes to Scrape
- Books to Scrape

Any other reachable URL can be analyzed, subject to the target site's policies and browser compatibility.

## Project Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Cloudflare Worker locally |
| `npm run dev:frontend` | Start the Vite development server |
| `npm run build` | Typecheck and build the frontend |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run the test suite |
| `npm run build:worker` | Validate the Worker deployment (dry run) |
| `npm run deploy:worker` | Deploy the Worker to Cloudflare |

## License

This project is licensed under the [MIT License](LICENSE).

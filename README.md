# AlphaX

AlphaX is a human-supervised WebMCP mediation layer. It uses a controlled Playwright browser to inspect an existing website, propose structured tools, and execute approved actions through a live browser session.

## What It Does

1. Navigate to a target URL in a headless Chromium session.
2. Inspect the page DOM, forms, links, headings, and interactive controls.
3. Generate WebMCP tool proposals with JSON Schema inputs.
4. Review, edit, approve, or reject proposed tools.
5. Register approved tools through `document.modelContext`, `window.modelContext`, and `navigator.modelContext`.
6. Execute recipes through Playwright with human supervision and execution logging.
7. Store tools and execution history locally, with optional Supabase persistence.

The application includes a zero-key heuristic tool generator. GroqCloud and Gemini are optional enhancements.

## Architecture

```text
Browser UI
  | REST and WebSocket
  v
Express server
  |-- BrowserManager -> Playwright Chromium -> target website
  |-- LLMToolGenerator -> GroqCloud, Gemini, or heuristics
  |-- ActionExecutor -> supervised recipe execution
  |-- PersistenceStore -> local memory and optional Supabase
  v
WebMCP Bridge -> document.modelContext / window.modelContext / navigator.modelContext
```

## Requirements

- Node.js 18 or newer
- npm
- Chromium dependencies when running Playwright on Linux outside a managed image
- Optional: Supabase project and LLM provider API key

## Install

```bash
git clone https://github.com/Fredincorporation/AlphaX.git
cd AlphaX
npm install
```

The `postinstall` script downloads the Playwright Chromium binary into the project-local Playwright directory. It does not run the privileged Linux package installation by default, which keeps hosted builds such as Render non-interactive.

To explicitly install operating-system dependencies in an environment where you have permission to do so:

```bash
PLAYWRIGHT_INSTALL_DEPS=true npm install
```

## Configuration

Create a `.env` file when you need server-side or frontend configuration. All provider keys are optional.

```env
# Optional Supabase persistence
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional neural tool synthesis
GROQ_API_KEY=your-groq-key
GEMINI_API_KEY=your-gemini-key

# Server
PORT=3001
# Keep this at 1 on small hosted instances; increase only with sufficient RAM.
MAX_BROWSER_SESSIONS=1

# Frontend-to-backend URLs for a separately deployed frontend
VITE_API_URL=https://your-backend.example.com
VITE_WS_URL=wss://your-backend.example.com
```

When `VITE_API_URL` and `VITE_WS_URL` are unset, the frontend uses same-origin requests. Vite proxies `/api` and `/ws` to `http://localhost:3001` during local development.

If Supabase is enabled, run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor. Without Supabase, AlphaX uses its in-memory persistence fallback.

## Run Locally

Run the backend:

```bash
npm run dev
```

Run the Vite frontend in a second terminal:

```bash
npm run dev:frontend
```

Open `http://localhost:5173`.

Useful local endpoints:

- `GET /api/health` - process memory, uptime, and active browser-session metrics
- `GET /api/samples` - available sample targets
- `POST /api/analyze` - navigate, analyze, and generate tools
- `GET /api/tools` - list stored tools
- `POST /api/tools/execute` - execute a tool recipe
- `GET /api/history` - execution history
- `ws://localhost:3001/ws?sessionId=...` - live status and confirmation events

## Production Build

```bash
npm run typecheck
npm test
npm run build
npm start
```

The production server serves the Vite output when `NODE_ENV=production`. The `start` script uses `scripts/start-server.cjs` to select the same project-local Playwright browser path used during installation.

### Render

Use these settings for a combined backend and frontend deployment:

- Build command: `npm install`
- Start command: `npm start`
- Environment: `NODE_ENV=production`

Do not add `npx playwright install --with-deps chromium` to the build command. `--with-deps` attempts privileged operating-system package installation and can fail in Render's non-interactive build environment. The postinstall script already installs Chromium without that step.

For a separately deployed frontend, set `VITE_API_URL` and `VITE_WS_URL` before the frontend build. The backend must allow the frontend origin through its CORS configuration and expose both HTTP and WebSocket traffic.

## Supervision Modes

- **Strict**: every tool execution requires human approval.
- **Supervised**: read-only tools run automatically; writes and sensitive actions require approval.
- **Autonomous**: actions run without an approval prompt, but remain logged.

Tool execution is serialized because all actions in a session share one Playwright page. This prevents simultaneous calls from navigating or modifying the page at the same time.

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
| `npm run dev` | Start the Express backend with `tsx` |
| `npm run dev:frontend` | Start the Vite development server |
| `npm run build` | Typecheck and build the frontend |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run the Node test suite |
| `npm start` | Start the production server |
| `npm run postinstall` | Install the project-local Playwright browser |

## License

This project is licensed under the [MIT License](LICENSE).

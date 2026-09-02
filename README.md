# AlphaX — Universal Agent Mediation Layer (WebMCP)
> **Turn ANY existing website into a reliable, human-supervised, agent-native surface using WebMCP.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![WebMCP: Standard](https://img.shields.io/badge/WebMCP-Imperative%20API-cyan.svg)](https://github.com/web-model-context-protocol)
[![Playwright: Enabled](https://img.shields.io/badge/Playwright-Headless%20Workers-emerald.svg)](https://playwright.dev)
[![Supabase: Integrated](https://img.shields.io/badge/Supabase-Persistence%20%26%20Audit-emerald.svg)](https://supabase.com/)
[![GroqCloud: Powered](https://img.shields.io/badge/GroqCloud-Llama%203.3%2070B-orange.svg)](https://groq.com/)
[![TypeScript: 5.7](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

---

## 🌟 Executive Summary & Impact Narrative

WebMCP (Web Model Context Protocol) is the frontier standard enabling autonomous AI agents (ChatGPT in-app browser, Chrome with `#enable-webmcp-testing`, Claude Computer Use, etc.) to discover and invoke structured tools exposed directly by web applications.

However, the WebMCP ecosystem currently faces a classic **chicken-and-egg adoption dilemma**:
1. AI agents cannot use tools on 99.999% of websites because webmasters have not rewritten their websites to expose WebMCP endpoints.
2. Webmasters will not prioritize implementing WebMCP until billions of agents routinely invoke them.
3. Users and enterprises cannot let agents act autonomously on unvetted websites without visual transparency, confirmation gates, and cryptographic provenance auditing.

**AlphaX solves this fundamentally.**

**AlphaX turns the entire existing web into an agent-native surface under human supervision.** Users paste *any* arbitrary URL (e.g. Hacker News, GitHub, Wikipedia, flight search portals, e-commerce stores, or custom SaaS apps), and AlphaX dynamically:
1. **Orchestrates** a controlled browser session via Playwright.
2. **Analyzes** DOM hierarchy, forms, interactive controls, and accessibility tree.
3. **Synthesizes** 6–15 high-level, semantic WebMCP tools with JSON Schema input validation using GroqCloud (`llama-3.3-70b-versatile`), Google Gemini (`gemini-1.5-flash`), or a zero-key AST heuristic engine.
4. **Reviews & Approves** proposed tools in a human operator console.
5. **Registers** approved tools dynamically onto `document.modelContext.registerTool()`, `window.modelContext`, and `navigator.modelContext`.
6. **Executes** agent tool calls in real time via Playwright, strictly gated by supervision policy modes (**Strict**, **Supervised**, **Autonomous**).
7. **Persists & Audits** tool recipes, parameters, screenshots, and execution traces directly into Supabase.

---

## 🏛️ System Architecture

```
                                      ┌────────────────────────────────────────────────────────┐
                                      │                      AI AGENT                          │
                                      │  (ChatGPT / Chrome #enable-webmcp-testing / Claude)   │
                                      └──────────────────────────┬─────────────────────────────┘
                                                                 │
                                                    WebMCP Tool Discovery & Calls
                                            (document.modelContext.registerTool / execute)
                                                                 │
                                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    ALPHAX MEDIATION LAYER                                     │
│                                                                                              │
│   ┌───────────────────────────┐   ┌───────────────────────────┐   ┌──────────────────────┐   │
│   │   WebMCP Dynamic Bridge   │   │  Tri-Mode Policy Guard    │   │ LLM Tool Synthesizer │   │
│   │  • document.modelContext  │   │  • Strict Mode            │   │  • GroqCloud Primary │   │
│   │  • window.modelContext    │   │  • Supervised (Gate Gated)│   │  • Google Gemini Fall│   │
│   │  • navigator.modelContext │   │  • Autonomous             │   │  • Zero-Key AST Fall │   │
│   └─────────────┬─────────────┘   └─────────────┬─────────────┘   └──────────┬───────────┘   │
│                 │                               │                            │               │
│                 └───────────────────────┬───────┴────────────────────────────┘               │
│                                         │                                                    │
│                                         ▼                                                    │
│                           ┌───────────────────────────┐                                      │
│                           │  Playwright Action Runner │                                      │
│                           │  • Multi-step execution   │                                      │
│                           │  • Live viewport stream   │                                      │
│                           │  • Visual state capture   │                                      │
│                           └─────────────┬─────────────┘                                      │
└─────────────────────────────────────────┼────────────────────────────────────────────────────┘
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    ▼                                           ▼
       ┌────────────────────────┐                  ┌────────────────────────┐
       │   TARGET WEB SURFACE   │                  │   SUPABASE PERSISTENCE │
       │  (Hacker News, GitHub, │                  │  • domains             │
       │   Wikipedia, Sandbox)  │                  │  • saved_tools         │
       │                        │                  │  • tool_executions     │
       │                        │                  │  • audit_logs          │
       └────────────────────────┘                  └────────────────────────┘
```

---

## ⚡ Key Capabilities & Technical Highlights

### 1. 🚀 GroqCloud + Gemini Neural Tool Synthesis with AST Fallback
- **Primary Engine**: High-velocity LLM inference on GroqCloud (`llama-3.3-70b-versatile`).
- **Secondary Fallback**: Google Gemini (`gemini-1.5-flash` / `gemini-2.0-flash`).
- **Zero-Key Heuristic Engine**: Built-in AST / DOM structural parser that synthesizes 6–12 semantic WebMCP tools without requiring any API keys.

### 2. 🔌 Standard Imperative WebMCP Implementation
AlphaX conforms to the official Imperative WebMCP specification:
- Exposes standard discovery and execution methods directly on `document.modelContext`, `window.modelContext`, and `navigator.modelContext`.
- Dispatches `CustomEvent('webmcp:tools-changed')` for instant runtime synchronization with agent environments (e.g. Chrome `#enable-webmcp-testing` and AI web-browsers).

### 3. 🛡️ Human-in-the-Loop Supervision Modes
- **Strict Mode**: Requires human approval on every single tool execution.
- **Supervised Mode** *(Default)*: Allows `readOnly` queries automatically; strictly triggers an interactive confirmation modal with a 60-second countdown for sensitive/destructive operations.
- **Autonomous Mode**: Executes actions at full speed while logging every step to the cryptographic provenance feed.

### 4. 🗄️ Cloud-Native Supabase Persistence & Audit
- Fully typed Supabase integration across tables: `domains`, `saved_tools` (with versioning), `tool_executions`, and `audit_logs`.
- Resilient local memory cache ensuring 100% functionality even during zero-configuration initial boots.

---

## 🛠️ Quickstart & Setup Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm** / **pnpm**

### 2. Installation
```bash
# Clone repository
git clone https://github.com/your-org/alphax-webmcp.git
cd alphax-webmcp

# Install dependencies
npm install

# Install Playwright browser binaries
npx playwright install chromium
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure your credentials:
```env
# Supabase (Database & Audit Logs)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# LLM Providers (Optional for neural synthesis; AST heuristic works out of the box)
GROQ_API_KEY=gsk_your_groq_key
GEMINI_API_KEY=your_gemini_key

# Runtime Settings
PLAYWRIGHT_HEADLESS=true
PORT=3001
VITE_PORT=5173
```

### 4. Supabase Database Schema (One-Click Setup)
If using Supabase, run the SQL script located at `supabase/schema.sql` in your Supabase SQL Editor to create the necessary tables (`domains`, `saved_tools`, `tool_executions`, `audit_logs`).

### 5. Running AlphaX
```bash
# Start backend Express server & Vite client
npm run dev
```

AlphaX will be live at:
- Frontend Dashboard: `http://localhost:5173` (or `http://localhost:3001`)
- WebSocket Bridge: `ws://localhost:3001/ws`
- Health Endpoint: `http://localhost:3001/api/samples`

---

## 🎯 Demo Target Scenarios

AlphaX includes out-of-the-box prebuilt recipes and live navigation presets for:
1. **Hacker News (`news.ycombinator.com`)**: Extract top stories with points and submitters, search stories via Algolia.
2. **Wikipedia (`en.wikipedia.org`)**: Search articles and extract structured infoboxes.
3. **GitHub (`github.com`)**: Search open-source repositories and extract descriptions.
4. **Quotes to Scrape Sandbox (`quotes.toscrape.com`)**: Extract quotes, authors, and tag metadata.
5. **Books to Scrape Sandbox (`books.toscrape.com`)**: Browse catalog and test gated add-to-cart operations with risk confirmation.

---

## 🎬 3-Minute Demo Video Script

| Timestamp | Video Screen Action | Spoken Voiceover Script |
|:---|:---|:---|
| **0:00 - 0:30** | Show AlphaX dashboard. Highlight the Live Browser View, Tool Review Panel, and Agent Playground. | *"Welcome to AlphaX — the Universal Agent Mediation Layer for WebMCP. Today, 99.9% of the web is unequipped for autonomous AI agents. AlphaX solves this instantly by bridging any existing website into a safe, human-supervised WebMCP surface."* |
| **0:30 - 1:10** | Select the **Hacker News** quick-launch chip and click **Generate Tools**. Live viewport renders while GroqCloud synthesizes tools in under 1 second. | *"Let’s test Hacker News. In one click, AlphaX launches Playwright, analyzes the DOM and accessibility tree, and leverages GroqCloud's Llama 3.3 70B to synthesize high-level WebMCP tools with complete JSON Schemas."* |
| **1:10 - 1:45** | Click **Approve All** in the Tool Review Panel. Show console log: `document.modelContext.registerTool()`. | *"As human operators, we can review or edit each tool recipe. Once approved, AlphaX dynamically binds them onto `document.modelContext`. Now, any agent running in Chrome or ChatGPT can discover and invoke these tools."* |
| **1:45 - 2:25** | In the **Agent Playground**, run the autonomous agent simulation or invoke `get_top_stories`. Show real-time Playwright execution and live viewport stream. Switch to **Books to Scrape** and trigger a gated `simulate_add_to_cart`. Show Confirmation Modal countdown. | *"Watch the agent invoke `get_top_stories`. AlphaX translates the call into Playwright actions, streaming live screenshots and telemetry. When a sensitive write action like `add_to_cart` is requested, our Supervision Gatekeeper triggers this confirmation modal with risk analysis."* |
| **2:25 - 3:00** | Click **Approve & Execute**. Point out the updated Supabase audit log and Provenance Feed. | *"Once approved, the action executes, and complete cryptographic provenance is persisted directly into Supabase. AlphaX makes the entire web agent-native, safe, and enterprise-ready today."* |

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).

import type { BrowserWorker } from '@cloudflare/puppeteer';

export interface Env {
  DB: D1Database;
  SESSIONS: DurableObjectNamespace;
  BROWSER: BrowserWorker;
  CACHE?: KVNamespace;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ALLOWED_ORIGIN?: string;
}

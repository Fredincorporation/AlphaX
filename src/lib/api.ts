// Central backend configuration.
// Vercel: set VITE_API_URL=https://alphax-hv72.onrender.com and VITE_WS_URL=wss://alphax-hv72.onrender.com
// When unset (local dev), empty base = same-origin, which vite.config.ts proxies to localhost:3001.
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';
export const WS_BASE: string = (import.meta.env.VITE_WS_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

/** Build an absolute URL for a backend API path (e.g. '/api/analyze'). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

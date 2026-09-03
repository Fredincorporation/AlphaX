// Central backend configuration.
// Vercel: set these to the deployed Cloudflare Worker API hostname.
// When unset (local dev), empty base = same-origin, which vite.config.ts proxies to localhost:3001.
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';
export const WS_BASE: string = (import.meta.env.VITE_WS_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

/** Build an absolute URL for a backend API path (e.g. '/api/analyze'). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

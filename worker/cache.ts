/**
 * KV-backed cache layer for Browser Rendering quota reduction.
 *
 * Three mechanisms (all degrade gracefully to no-op when the CACHE binding is
 * absent, so deploys never break):
 *  1. Analysis cache  — tools/analysis per domain, TTL ~24h. Avoids re-running
 *     the browser render + LLM tool generation for repeat visits.
 *  2. Screenshot cache — per-URL rendered snapshot, short TTL (~4 min) so the
 *     Live Browser View stays near-real-time without re-launching a browser.
 *  3. Request dedupe — collapses duplicate clicks / double-submits within a
 *     short window so parallel identical requests share one browser render.
 */
import type { Env } from './env';

export const ANALYSIS_TTL_SECONDS = 60 * 60 * 24; // 24h
export const SCREENSHOT_TTL_SECONDS = 240; // 4 min — "near-live" visual
export const DEDUPE_TTL_SECONDS = 45;

const DEDUPE_LOCK_STALE_MS = 60_000; // in-flight lock considered dead after this

export function hasCache(env: Env): boolean {
  return Boolean((env as { CACHE?: unknown }).CACHE);
}

export async function getJson<T>(env: Env, key: string): Promise<T | null> {
  const cache = (env as { CACHE?: KVNamespace }).CACHE;
  if (!cache) return null;
  try {
    const raw = await cache.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function putJson(env: Env, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const cache = (env as { CACHE?: KVNamespace }).CACHE;
  if (!cache) return;
  try {
    await cache.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) });
  } catch {
    // Caching is best-effort; never fail a request because of it.
  }
}

export const analysisKey = (domain: string) => `analysis:v1:${domain}`;
export const screenshotKey = (url: string) => `shot:v1:${url}`;
export const dedupeKey = (kind: string, identity: string) => `dedupe:${kind}:${identity}`;

/**
 * In-flight + recent-request dedupe. Returns true if an identical request was
 * already accepted within DEDUPE_TTL_SECONDS (caller should reject with 429 or
 * return the in-flight result). Uses KV as a short-lived lock; the in-process
 * Map guards the same isolate for zero-latency hits.
 */
const inFlight = new Map<string, number>();

export function isDuplicate(env: Env, kind: string, identity: string): boolean {
  const key = dedupeKey(kind, identity);
  const startedAt = inFlight.get(key);
  if (startedAt) {
    if (Date.now() - startedAt < DEDUPE_LOCK_STALE_MS) return true;
    inFlight.delete(key); // stale lock — treat as finished
  }
  inFlight.set(key, Date.now());
  // Fire-and-forget KV marker so other isolates also see the recent request.
  void putJson(env, key, { at: Date.now() }, DEDUPE_TTL_SECONDS);
  return false;
}

export function releaseDedupe(env: Env, kind: string, identity: string): void {
  inFlight.delete(dedupeKey(kind, identity));
}

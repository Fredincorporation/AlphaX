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

// In-flight lock only: a request is a duplicate while it is still running (plus
// a small grace period), NOT for a window after it completes. Re-analyzing a
// URL seconds after a successful analyze must be allowed — that's what the
// analysis cache serves, not the dedupe gate.
const DEDUPE_LOCK_STALE_MS = 15_000; // in-flight lock considered dead after this

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
 * In-flight dedupe. Returns true only while an identical request is still
 * executing (or its lock is within the small stale grace window). A completed
 * request does NOT block later identical requests — cache layers handle those.
 * The in-process Map is per-isolate; Workers request coalescing plus short
 * execution times make cross-isolate locking unnecessary here.
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
  return false;
}

export function releaseDedupe(env: Env, kind: string, identity: string): void {
  inFlight.delete(dedupeKey(kind, identity));
}

/**
 * Two-layer sliding-window rate limiter.
 *
 * 1. Memory layer (`checkMemoryRateLimit`): a per-process sliding log. Each key keeps the
 *    timestamps of its accepted hits inside the window; a request is allowed when fewer
 *    than `limit` hits fall in the last `windowMs` (no 2x burst at window boundaries).
 *    It rejects early without touching the database.
 * 2. Database layer (`swosh_rate_limit` RPC, see supabase_setup.sql): the same sliding
 *    log stored in `rate_limit_hits`, serialised per key with an advisory lock, so the
 *    limit is shared by every server instance. When the memory layer allows a request
 *    the database decides.
 *
 * If the RPC fails (migration not run yet, database unreachable) the error is logged
 * once and the memory result is used, so the app keeps working with per-process limits.
 *
 * Stale memory keys are evicted by a periodic sweep (and lazily on access) so memory stays
 * bounded by the number of keys active within their window.
 */

import { HttpError } from "@/lib/http";
import { supabase } from "@/lib/supabase";

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the next slot frees up. */
  reset: number;
}

interface Entry {
  hits: number[];
  windowMs: number;
}

const store = new Map<string, Entry>();
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

function prune(entry: Entry, now: number) {
  const cutoff = now - entry.windowMs;
  let i = 0;
  while (i < entry.hits.length && entry.hits[i] <= cutoff) i++;
  if (i > 0) entry.hits.splice(0, i);
}

/** Removes keys with no hits inside their window. Exported for tests. */
export function sweepRateLimits(now = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of store) {
    prune(entry, now);
    if (entry.hits.length === 0) {
      store.delete(key);
      removed++;
    }
  }
  lastSweep = now;
  return removed;
}

export function rateLimitKeyCount(): number {
  return store.size;
}

/** Clears the memory layer and the database-layer error state (tests). */
export function resetRateLimits(): void {
  store.clear();
  dbWarned = false;
  dbDisabledUntil = 0;
}

/** Synchronous, per-process sliding log (first layer). */
export function checkMemoryRateLimit(identifier: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (now - lastSweep > SWEEP_INTERVAL_MS) sweepRateLimits(now);

  let entry = store.get(identifier);
  if (!entry) {
    entry = { hits: [], windowMs };
    store.set(identifier, entry);
  }
  entry.windowMs = Math.max(entry.windowMs, windowMs);
  prune(entry, now);

  if (entry.hits.length >= limit) {
    return { success: false, limit, remaining: 0, reset: entry.hits[0] + windowMs };
  }
  entry.hits.push(now);
  const reset = entry.hits[0] + windowMs;
  return { success: true, limit, remaining: limit - entry.hits.length, reset };
}

/** Removes a hit recorded by checkMemoryRateLimit (the database denied that request). */
function undoMemoryHit(identifier: string, at: number) {
  const entry = store.get(identifier);
  if (!entry) return;
  const i = entry.hits.lastIndexOf(at);
  if (i >= 0) entry.hits.splice(i, 1);
}

// ---------------------------------------------------------------- database layer

/** After an RPC failure, skip the database for this long (avoid a failing call per request). */
const DB_RETRY_MS = 60_000;
let dbWarned = false;
let dbDisabledUntil = 0;

interface DbRow {
  allowed: boolean;
  remaining: number;
  reset_ms: number | string;
}

function isDbRow(v: unknown): v is DbRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.allowed === "boolean" &&
    typeof r.remaining === "number" &&
    (typeof r.reset_ms === "number" || (typeof r.reset_ms === "string" && r.reset_ms.trim() !== ""))
  );
}

async function checkDbRateLimit(identifier: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("swosh_rate_limit", {
    p_key: identifier,
    p_limit: limit,
    p_window_ms: Math.round(windowMs),
  });
  if (error) throw error;
  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (!isDbRow(row)) throw new Error("swosh_rate_limit returned an unexpected shape");
  const resetMs = Number(row.reset_ms);
  return {
    success: row.allowed,
    limit,
    remaining: Math.max(0, row.remaining),
    reset: Date.now() + (Number.isFinite(resetMs) ? Math.max(0, resetMs) : windowMs),
  };
}

/**
 * Memory layer first (rejects without a DB call); if it allows, the shared database
 * limit decides. Falls back to the memory result when the database layer fails.
 */
export async function checkRateLimit(identifier: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const memory = checkMemoryRateLimit(identifier, limit, windowMs, now);
  if (!memory.success) return memory;
  if (now < dbDisabledUntil) return memory;
  try {
    const db = await checkDbRateLimit(identifier, limit, windowMs);
    if (!db.success) undoMemoryHit(identifier, now);
    return db;
  } catch (err) {
    dbDisabledUntil = Date.now() + DB_RETRY_MS;
    if (!dbWarned) {
      dbWarned = true;
      console.error("[rate-limit] shared limiter unavailable, using per-process limits:", err);
    }
    return memory;
  }
}

/** Throws a 429 HttpError (code "rate_limited", with Retry-After) when over the limit. Always await it. */
export async function enforceRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
  message = "Too many requests. Please slow down."
): Promise<void> {
  const result = await checkRateLimit(identifier, limit, windowMs);
  if (!result.success) {
    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    throw new HttpError(429, message, "rate_limited", { "Retry-After": String(retryAfter) });
  }
}

export const MINUTE = 60_000;

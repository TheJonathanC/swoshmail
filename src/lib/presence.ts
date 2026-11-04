/**
 * Server-authoritative chat presence: pure helpers shared by the API route and the
 * browser (no server-only imports).
 *
 * - Clients POST /api/chat/presence "online" every PRESENCE_HEARTBEAT_MS while the page
 *   is visible, and "offline" when it is hidden / closed / signed out.
 * - The server stores users.last_seen_at. It refreshes the column (and broadcasts to
 *   partners) at most once per PRESENCE_MIN_REFRESH_MS, whatever the number of tabs.
 * - A user is online when last_seen_at is within PRESENCE_ONLINE_WINDOW_MS. That window
 *   exceeds the worst refresh gap (MIN_REFRESH + HEARTBEAT = 45 s), so an active user
 *   never flickers offline.
 */

export const PRESENCE_HEARTBEAT_MS = 25_000;
export const PRESENCE_MIN_REFRESH_MS = 20_000;
export const PRESENCE_ONLINE_WINDOW_MS = 70_000;
/** How often clients re-evaluate isOnline() for the list. */
export const PRESENCE_TICK_MS = 10_000;

export type PresenceState = "online" | "offline";

export function isPresenceState(v: unknown): v is PresenceState {
  return v === "online" || v === "offline";
}

/** True when `lastSeen` (ISO string or null) is within the online window of `now` (epoch ms). */
export function isOnline(lastSeen: string | null | undefined, now: number, windowMs = PRESENCE_ONLINE_WINDOW_MS): boolean {
  if (!lastSeen) return false;
  const t = Date.parse(lastSeen);
  if (Number.isNaN(t)) return false;
  // Allow a little future skew (server clock ahead of the reference clock).
  return t <= now + windowMs && now - t < windowMs;
}

/** An "online" heartbeat refreshes last_seen_at only when the stored value is older than this cutoff (or null). */
export function presenceRefreshCutoff(now: number, minRefreshMs = PRESENCE_MIN_REFRESH_MS): string {
  return new Date(now - minRefreshMs).toISOString();
}

/** Newer of two last-seen values; null (offline) only when `incoming` is null. */
export function mergeLastSeen(current: string | null | undefined, incoming: string | null): string | null {
  if (incoming === null) return null;
  if (!current) return incoming;
  const a = Date.parse(current);
  const b = Date.parse(incoming);
  if (Number.isNaN(a)) return incoming;
  if (Number.isNaN(b)) return current;
  return b >= a ? incoming : current;
}

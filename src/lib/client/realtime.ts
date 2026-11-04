"use client";

/**
 * Browser-side Supabase Realtime access for Swosh Chat.
 *
 * - Imports only @supabase/realtime-js (not the whole supabase-js bundle).
 * - Authenticates with a short-lived JWT from GET /api/chat/realtime-token; the
 *   `accessToken` callback is re-invoked by realtime-js on every heartbeat, and we
 *   refresh the token shortly before it expires.
 * - Clients only ever LISTEN on private channels. All broadcasting happens on the server,
 *   including presence (there is no client-tracked presence channel; see
 *   POST /api/chat/presence and the "presence" event on the user channel).
 * - The socket is ref-counted and torn down (after a short grace period, so React
 *   StrictMode's mount/unmount/mount doesn't thrash it) when nobody uses it.
 */

import { RealtimeClient, type RealtimeChannel, type RealtimeChannelOptions } from "@supabase/realtime-js";
import type { RealtimeTokenResponse } from "@/types/api";

export type { RealtimeChannel } from "@supabase/realtime-js";

/** Status of one subscribed channel as seen by the UI. */
export type ChannelStatus = "connecting" | "live" | "failed";

export const convTopic = (conversationId: string) => `swoshchat:conv:${conversationId}`;
export const userTopic = (userId: string) => `swoshchat:user:${userId}`;

/** Refresh the token when it has less than this long left. */
const REFRESH_MARGIN_MS = 60_000;
/** Keep the socket around briefly after the last release (StrictMode / quick remounts). */
const RELEASE_GRACE_MS = 3_000;

interface TokenState {
  token: string;
  expiresAtMs: number;
}

/** Token endpoint may also return connection info (see the comment in src/types/api.ts). */
type TokenPayload = RealtimeTokenResponse & { url?: unknown; anonKey?: unknown };

let client: RealtimeClient | null = null;
let clientPromise: Promise<RealtimeClient | null> | null = null;
let tokenState: TokenState | null = null;
let tokenPromise: Promise<TokenPayload | null> | null = null;
let refCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function isTokenPayload(value: unknown): value is TokenPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.token === "string" && v.token.length > 0 && typeof v.expiresAt === "number";
}

/** `expiresAt` may be epoch seconds (JWT style) or epoch milliseconds; normalise to ms. */
function toMs(expiresAt: number): number {
  return expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
}

async function requestToken(): Promise<TokenPayload | null> {
  try {
    const res = await fetch("/api/chat/realtime-token", { cache: "no-store" });
    // 503 { code: "realtime_unconfigured" }, 401 (signed out), 429, 5xx -> no realtime.
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!isTokenPayload(data)) return null;
    tokenState = { token: data.token, expiresAtMs: toMs(data.expiresAt) };
    return data;
  } catch {
    return null;
  }
}

function fetchTokenOnce(): Promise<TokenPayload | null> {
  if (!tokenPromise) {
    tokenPromise = requestToken().finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

/** Called by realtime-js on connect and on every heartbeat. */
async function accessToken(): Promise<string | null> {
  if (tokenState && tokenState.expiresAtMs - Date.now() > REFRESH_MARGIN_MS) return tokenState.token;
  await fetchTokenOnce();
  // On refresh failure keep the old token; the server will reject it when it truly expires
  // and channels report CHANNEL_ERROR, which flips the UI to polling.
  return tokenState?.token ?? null;
}

function resolveEndpoint(payload: TokenPayload): { endpoint: string; apiKey: string } | null {
  const url =
    (typeof payload.url === "string" && payload.url) || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const apiKey =
    (typeof payload.anonKey === "string" && payload.anonKey) || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !apiKey) return null;
  try {
    const u = new URL("realtime/v1", url.endsWith("/") ? url : `${url}/`);
    u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
    return { endpoint: u.toString().replace(/\/$/, ""), apiKey };
  } catch {
    return null;
  }
}

async function createClient(): Promise<RealtimeClient | null> {
  const payload = await fetchTokenOnce();
  if (!payload) return null;
  const target = resolveEndpoint(payload);
  if (!target) return null;

  const rt = new RealtimeClient(target.endpoint, {
    params: { apikey: target.apiKey },
    accessToken,
  });
  try {
    // No explicit token: realtime-js pulls it from `accessToken` (cached above) and keeps
    // calling that callback on heartbeats, which is how the token gets refreshed.
    await rt.setAuth();
  } catch {
    return null;
  }
  rt.connect();
  return rt;
}

/**
 * Acquire the shared realtime client. Resolves to null when realtime is unavailable
 * (unconfigured server, signed out, network failure) so callers can fall back to polling.
 * Every successful call must be paired with releaseRealtime().
 */
export function acquireRealtime(): Promise<RealtimeClient | null> {
  refCount += 1;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (client) return Promise.resolve(client);
  if (!clientPromise) {
    clientPromise = createClient().then((rt) => {
      client = rt;
      // Allow a later acquire to retry if this attempt failed.
      if (!rt) clientPromise = null;
      return rt;
    });
  }
  return clientPromise;
}

export function releaseRealtime(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0 || releaseTimer) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (refCount > 0) return;
    const rt = client;
    client = null;
    clientPromise = null;
    tokenState = null;
    if (rt) {
      void rt.removeAllChannels().finally(() => {
        void rt.disconnect();
      });
    }
  }, RELEASE_GRACE_MS);
}

/** Pending removals per topic, so a re-subscribe waits for the previous channel to close. */
const teardowns = new Map<string, Promise<unknown>>();

export interface OpenChannelOptions {
  /** Register listeners on the fresh channel before it subscribes. */
  configure: (channel: RealtimeChannel) => void;
  onStatus: (status: ChannelStatus, channel: RealtimeChannel) => void;
}

/**
 * Open a PRIVATE channel and return a cleanup function that removes it.
 * Safe under StrictMode double effects: realtime-js returns an existing channel for the
 * same topic until it has closed, so we serialise open-after-close per topic and never
 * attach listeners to a channel that is being torn down.
 */
export function openPrivateChannel(rt: RealtimeClient, topic: string, opts: OpenChannelOptions): () => void {
  let cancelled = false;
  let channel: RealtimeChannel | null = null;

  const prior = teardowns.get(topic) ?? Promise.resolve();
  void prior.then(async () => {
    if (cancelled) return;
    const stale = rt.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (stale) {
      await rt.removeChannel(stale).catch(() => undefined);
      if (cancelled) return;
    }
    const config: RealtimeChannelOptions["config"] = { private: true };
    const ch = rt.channel(topic, { config });
    channel = ch;
    opts.configure(ch);
    ch.subscribe((status) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") opts.onStatus("live", ch);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") opts.onStatus("failed", ch);
      // "CLOSED" happens on our own removal; nothing to report.
    });
  });

  return () => {
    cancelled = true;
    const ch = channel;
    channel = null;
    if (!ch) return;
    const removal: Promise<unknown> = rt
      .removeChannel(ch)
      .catch(() => undefined)
      .finally(() => {
        if (teardowns.get(topic) === removal) teardowns.delete(topic);
      });
    teardowns.set(topic, removal);
  };
}

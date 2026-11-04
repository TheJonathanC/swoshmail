/**
 * Server -> client realtime delivery via the Supabase Realtime REST broadcast endpoint.
 *
 * Endpoint and body match @supabase/realtime-js `RealtimeChannel.send()` REST path:
 *   POST ${SUPABASE_URL}/realtime/v1/api/broadcast
 *   headers: apikey, Authorization: Bearer <service role>
 *   body: { messages: [{ topic, event, payload, private: true }] }
 * The service role bypasses realtime.messages RLS; clients can only receive.
 *
 * Delivery is best-effort: failures are logged and never fail the API request.
 */
import { createHmac } from "crypto";
import { supabaseUrl } from "@/lib/supabase";
import type { RealtimeEvent } from "@/types/api";

export const convTopic = (conversationId: string) => `swoshchat:conv:${conversationId}`;
export const userTopic = (userId: string) => `swoshchat:user:${userId}`;

export interface BroadcastMessage {
  topic: string;
  event: RealtimeEvent["event"];
  payload: RealtimeEvent["payload"];
}

const BROADCAST_TIMEOUT_MS = 3000;

export async function broadcast(messages: BroadcastMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const base = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: messages.map((m) => ({ topic: m.topic, event: m.event, payload: m.payload, private: true })),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[realtime] broadcast failed (${res.status}):`, detail.slice(0, 500));
    } else {
      await res.body?.cancel().catch(() => undefined);
    }
  } catch (err) {
    console.error("[realtime] broadcast error:", err);
  } finally {
    clearTimeout(timer);
  }
}

/** Typed single-event helper. */
export function broadcastEvent<E extends RealtimeEvent>(topics: string[], event: E["event"], payload: E["payload"]): Promise<void> {
  return broadcast(topics.map((topic) => ({ topic, event, payload })));
}

// ---------------------------------------------------------------- JWT (HS256)

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface RealtimeJwtClaims {
  sub: string;
  role: "authenticated";
  aud: "authenticated";
  iat: number;
  exp: number;
}

export function signHs256(claims: object, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export const REALTIME_TOKEN_TTL_SECONDS = 60 * 60;

export function createRealtimeToken(userId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const claims: RealtimeJwtClaims = {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: nowSeconds,
    exp: nowSeconds + REALTIME_TOKEN_TTL_SECONDS,
  };
  return { token: signHs256(claims, secret), expiresAt: claims.exp * 1000 };
}

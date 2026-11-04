import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, readJson, route } from "@/lib/http";
import { broadcastEvent, userTopic } from "@/lib/realtime";
import { isPresenceState, presenceRefreshCutoff } from "@/lib/presence";
import type { PresenceResponse, RealtimeEvent } from "@/types/api";

type PresenceEvent = Extract<RealtimeEvent, { event: "presence" }>;

/** Upper bound on partners notified per change (fan-out guard). */
const MAX_PARTNERS = 1000;

async function partnerIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .limit(MAX_PARTNERS);
  if (error) {
    console.error("[presence] partner lookup failed:", error);
    return [];
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as { user1_id: string; user2_id: string }[]) {
    ids.add(row.user1_id === userId ? row.user2_id : row.user1_id);
  }
  ids.delete(userId);
  return Array.from(ids);
}

// POST /api/chat/presence { state: "online" | "offline" } -> PresenceResponse
// The only writer of users.last_seen_at. Clients cannot publish presence themselves.
export const POST = route("POST /api/chat/presence", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_presence_${user.id}`, 20, MINUTE);
  const body = await readJson<{ state: string }>(request, 1024);
  if (!isPresenceState(body.state)) throw badRequest('state must be "online" or "offline".');
  const online = body.state === "online";

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Conditional updates make the write (and the broadcast) happen only on a state
  // transition or when the stored heartbeat is older than PRESENCE_MIN_REFRESH_MS, so
  // several tabs (or a fast client) cannot multiply the fan-out.
  const changed = online
    ? (check(
        await supabase
          .from("users")
          .update({ last_seen_at: nowIso })
          .eq("id", user.id)
          .or(`last_seen_at.is.null,last_seen_at.lt."${presenceRefreshCutoff(now)}"`)
          .select("id"),
        "presence online"
      ) as { id: string }[] | null)
    : (check(
        await supabase
          .from("users")
          .update({ last_seen_at: null })
          .eq("id", user.id)
          .not("last_seen_at", "is", null)
          .select("id"),
        "presence offline"
      ) as { id: string }[] | null);

  if ((changed ?? []).length > 0) {
    const partners = await partnerIds(user.id);
    if (partners.length > 0) {
      await broadcastEvent<PresenceEvent>(partners.map(userTopic), "presence", {
        user_id: user.id,
        online,
        last_seen_at: online ? nowIso : null,
      });
    }
  }

  const res: PresenceResponse = { online, server_time: nowIso };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
});

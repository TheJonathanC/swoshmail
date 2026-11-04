import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, isUniqueViolation, notFound, readJson, route, serverError, type DbError } from "@/lib/http";
import { orderParticipants } from "@/lib/chat-format";
import { conversationFromJoinedRow } from "@/lib/chat";
import { broadcastEvent, userTopic } from "@/lib/realtime";
import type { ConversationListItem, ConversationsResponse, RealtimeEvent } from "@/types/api";

const joined = (userCols: string) =>
  `id, save_messages, user1_id, user2_id, created_at, user1:users!conversations_user1_id_fkey(${userCols}), user2:users!conversations_user2_id_fkey(${userCols})`;
const JOINED = joined("id, username, last_seen_at");
/** Pre-migration shape (no users.last_seen_at yet). */
const JOINED_LEGACY = joined("id, username");

type JoinedRow = Parameters<typeof conversationFromJoinedRow>[0];

const RECENT_INCOMING_LIMIT = 20;

let legacyWarned = false;
/** Undefined column (users.last_seen_at missing because the migration has not run). */
function isMissingColumn(err: DbError | null): boolean {
  if (!err) return false;
  const missing = err.code === "42703" || /last_seen_at/.test(err.message ?? "");
  if (missing && !legacyWarned) {
    legacyWarned = true;
    console.error("[chat] users.last_seen_at is missing; run supabase_setup.sql. Presence is disabled until then.", err);
  }
  return missing;
}

async function listRows(userId: string): Promise<JoinedRow[]> {
  const run = (cols: string) =>
    supabase
      .from("conversations")
      .select(cols)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order("created_at", { ascending: false });
  let result = await run(JOINED);
  if (isMissingColumn(result.error)) result = await run(JOINED_LEGACY);
  return (check(result, "list conversations") ?? []) as unknown as JoinedRow[];
}

let recentWarned = false;
/** conversation id -> latest incoming message ids (one RPC for all conversations). */
async function recentIncoming(userId: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const { data, error } = await supabase.rpc("swosh_recent_incoming", { p_user_id: userId, p_limit: RECENT_INCOMING_LIMIT });
  if (error) {
    // Optional feature (polling unread badges): never fail the list over it.
    if (!recentWarned) {
      recentWarned = true;
      console.error("[chat] swosh_recent_incoming failed (run supabase_setup.sql?):", error);
    }
    return map;
  }
  for (const row of (Array.isArray(data) ? data : []) as { conversation_id?: unknown; ids?: unknown }[]) {
    if (typeof row.conversation_id !== "string" || !Array.isArray(row.ids)) continue;
    map.set(row.conversation_id, row.ids.filter((id): id is string => typeof id === "string"));
  }
  return map;
}

// GET /api/chat/conversations -> ConversationsResponse
export const GET = route("GET /api/chat/conversations", async () => {
  const user = await requireUser();
  await enforceRateLimit(`chat_conv_list_${user.id}`, 120, MINUTE);
  const [rows, recent] = await Promise.all([listRows(user.id), recentIncoming(user.id)]);
  const conversations: ConversationListItem[] = rows.map((r) => ({
    ...conversationFromJoinedRow(r, user.id),
    recent_incoming_ids: recent.get(r.id) ?? [],
  }));
  const res: ConversationsResponse = { conversations };
  return NextResponse.json(res, { headers: { "Cache-Control": "private, no-store" } });
});

// POST /api/chat/conversations { username } -> { conversation }
export const POST = route("POST /api/chat/conversations", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_conv_create_${user.id}`, 20, MINUTE, "Too many new chats. Please wait a moment.");
  const body = await readJson<{ username: string; saveMessages: boolean }>(request);
  const username = typeof body.username === "string" ? body.username.trim().replace(/^@/, "") : "";
  if (!username || username.length > 255) throw badRequest("Username is required.");

  const target = check(
    await supabase.from("users").select("id, username").eq("username", username).maybeSingle(),
    "conversation target lookup"
  ) as { id: string; username: string } | null;
  if (!target) throw notFound("User not found.", "user_not_found");
  if (target.id === user.id) throw badRequest("You cannot start a chat with yourself.", "self_chat");

  const [u1, u2] = orderParticipants(user.id, target.id);
  const saveMessages = typeof body.saveMessages === "boolean" ? body.saveMessages : false;

  // Insert, and on a unique violation (existing pair or a concurrent create) read it back.
  const insertWith = (cols: string) =>
    supabase.from("conversations").insert({ user1_id: u1, user2_id: u2, save_messages: saveMessages }).select(cols).single();
  let cols = JOINED;
  let inserted = await insertWith(cols);
  if (isMissingColumn(inserted.error)) {
    // The failed statement rolled back; retry with the pre-migration shape.
    cols = JOINED_LEGACY;
    inserted = await insertWith(cols);
  }
  let row: JoinedRow;
  let created = false;
  if (inserted.error) {
    if (!isUniqueViolation(inserted.error)) return serverError("create conversation", inserted.error, "Could not start the chat.");
    const existing = check(
      await supabase.from("conversations").select(cols).eq("user1_id", u1).eq("user2_id", u2).maybeSingle(),
      "load existing conversation"
    ) as unknown as JoinedRow | null;
    if (!existing) return serverError("create conversation (race)", inserted.error, "Could not start the chat.");
    row = existing;
  } else {
    row = inserted.data as unknown as JoinedRow;
    created = true;
  }

  const conversation = conversationFromJoinedRow(row, user.id);
  if (created) {
    // Tell the other user (their view has *me* as the other participant).
    await broadcastEvent<Extract<RealtimeEvent, { event: "conversation" }>>(
      [userTopic(target.id)],
      "conversation",
      conversationFromJoinedRow(row, target.id)
    );
  }
  return NextResponse.json({ conversation });
});

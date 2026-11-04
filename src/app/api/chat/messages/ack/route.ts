import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, isUuid, readJson, requireUuid, route } from "@/lib/http";
import { getConversationForUser } from "@/lib/chat";
import { broadcastEvent, convTopic } from "@/lib/realtime";
import type { AckResponse, RealtimeEvent } from "@/types/api";

type ConsumedEvent = Extract<RealtimeEvent, { event: "messages_consumed" }>;

// POST /api/chat/messages/ack { conversationId, messageIds } -> { deleted }
// The recipient confirms it displayed ephemeral messages; only messages NOT sent by
// the caller, marked ephemeral, in this conversation are deleted.
export const POST = route("POST /api/chat/messages/ack", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_ack_${user.id}`, 120, MINUTE);
  const body = await readJson<{ conversationId: string; messageIds: unknown[] }>(request);
  const conversationId = requireUuid(body.conversationId, "conversationId");
  if (!Array.isArray(body.messageIds) || body.messageIds.length === 0) throw badRequest("messageIds is required.");
  if (body.messageIds.length > 500) throw badRequest("Too many messages in one acknowledgement.");
  if (!body.messageIds.every(isUuid)) throw badRequest("Invalid message id.");
  const ids = Array.from(new Set((body.messageIds as string[]).map((s) => s.toLowerCase())));

  const ctx = await getConversationForUser(conversationId, user.id);
  const rows = check(
    await supabase
      .from("messages")
      .delete()
      .eq("conversation_id", ctx.id)
      .eq("ephemeral", true)
      .neq("sender_id", user.id)
      .in("id", ids)
      .select("id"),
    "ack ephemeral messages"
  ) as { id: string }[];
  const deleted = (rows ?? []).map((r) => r.id);

  if (deleted.length > 0) {
    await broadcastEvent<ConsumedEvent>([convTopic(ctx.id)], "messages_consumed", { ids: deleted });
  }
  const res: AckResponse = { deleted };
  return NextResponse.json(res);
});

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, readJson, requireUuid, route } from "@/lib/http";
import { getConversationForUser, toConversation } from "@/lib/chat";
import { broadcastEvent, convTopic } from "@/lib/realtime";
import type { Conversation, RealtimeEvent } from "@/types/api";

// POST /api/chat/conversations/toggle { conversationId, saveMessages } -> { conversation }
// Applies to NEW messages only; existing messages keep their own ephemeral flag.
export const POST = route("POST /api/chat/conversations/toggle", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_toggle_${user.id}`, 20, MINUTE, "Too many changes. Please wait a moment.");
  const body = await readJson<{ conversationId: string; saveMessages: boolean }>(request);
  const conversationId = requireUuid(body.conversationId, "conversationId");
  if (typeof body.saveMessages !== "boolean") throw badRequest("saveMessages must be a boolean.");

  const ctx = await getConversationForUser(conversationId, user.id);
  check(
    await supabase.from("conversations").update({ save_messages: body.saveMessages }).eq("id", ctx.id),
    "toggle save_messages"
  );

  await broadcastEvent<Extract<RealtimeEvent, { event: "settings" }>>([convTopic(ctx.id)], "settings", {
    save_messages: body.saveMessages,
    changed_by: user.id,
  });
  const conversation: Conversation = toConversation({ ...ctx, save_messages: body.saveMessages });
  return NextResponse.json({ conversation });
});

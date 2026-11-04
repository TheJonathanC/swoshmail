import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, notFound, readJson, requireUuid, route } from "@/lib/http";
import {
  getConversationForUser,
  MESSAGE_COLUMNS,
  replySnippet,
  toChatMessages,
  type MessageRow,
} from "@/lib/chat";
import { decodeMessageContent, encodeMessageContent } from "@/lib/chat-format";
import { broadcastEvent, convTopic, userTopic } from "@/lib/realtime";
import { CHAT_HISTORY_LIMIT, CHAT_MAX_MESSAGE_LENGTH } from "@/lib/constants";
import type { ChatMessage, MessagesResponse, RealtimeEvent, SendMessageResponse } from "@/types/api";

type MessageEvent = Extract<RealtimeEvent, { event: "message" }>;
type EditedEvent = Extract<RealtimeEvent, { event: "message_edited" }>;
type DeletedEvent = Extract<RealtimeEvent, { event: "message_deleted" }>;

function validateText(input: unknown): string {
  if (typeof input !== "string") throw badRequest("Message content is required.");
  const text = input.trim();
  if (!text) throw badRequest("Message content is required.");
  if (text.length > CHAT_MAX_MESSAGE_LENGTH) throw badRequest(`Messages can be at most ${CHAT_MAX_MESSAGE_LENGTH} characters.`);
  return text;
}

// GET /api/chat/messages?conversationId= -> { messages } (read-only: never deletes)
export const GET = route("GET /api/chat/messages", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_get_${user.id}`, 120, MINUTE);
  const conversationId = requireUuid(new URL(request.url).searchParams.get("conversationId"), "conversationId");
  const ctx = await getConversationForUser(conversationId, user.id);

  const rows = check(
    await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", ctx.id)
      .order("created_at", { ascending: false })
      .limit(CHAT_HISTORY_LIMIT * 2),
    "list messages"
  ) as MessageRow[];

  const messages = await toChatMessages((rows ?? []).reverse(), ctx.names);
  const res: MessagesResponse = { messages };
  return NextResponse.json(res, { headers: { "Cache-Control": "private, no-store" } });
});

// POST /api/chat/messages { conversationId, content, replyToId?, clientId? } -> { message }
export const POST = route("POST /api/chat/messages", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_send_${user.id}`, 30, MINUTE, "You are sending messages too fast.");
  const body = await readJson<{ conversationId: string; content: string; replyToId: string | null; clientId: string }>(request, 64 * 1024);
  const conversationId = requireUuid(body.conversationId, "conversationId");
  const text = validateText(body.content);
  const clientId = typeof body.clientId === "string" ? body.clientId.slice(0, 64) : null;
  const ctx = await getConversationForUser(conversationId, user.id);

  // Reply quotes are resolved from the DB (same conversation only), never taken from the client.
  let replyToId: string | null = null;
  let snapshot: { sender_id: string; content: string } | null = null;
  if (body.replyToId) {
    const target = check(
      await supabase
        .from("messages")
        .select("id, sender_id, content")
        .eq("id", requireUuid(body.replyToId, "replyToId"))
        .eq("conversation_id", ctx.id)
        .maybeSingle(),
      "reply target lookup"
    ) as { id: string; sender_id: string; content: string } | null;
    if (!target) throw notFound("The message you are replying to no longer exists.", "reply_not_found");
    replyToId = target.id;
    snapshot = { sender_id: target.sender_id, content: replySnippet(decodeMessageContent(target.content).text) };
  }

  const row = check(
    await supabase
      .from("messages")
      .insert({
        conversation_id: ctx.id,
        sender_id: user.id,
        content: encodeMessageContent(text, replyToId, snapshot),
        ephemeral: !ctx.save_messages,
      })
      .select(MESSAGE_COLUMNS)
      .single(),
    "insert message"
  ) as MessageRow;
  // History pruning (100 per conversation) is done by a DB trigger.

  const [message] = await toChatMessages([row], ctx.names);
  const payload: ChatMessage = clientId ? { ...message, client_id: clientId } : message;
  await broadcastEvent<MessageEvent>([convTopic(ctx.id), userTopic(ctx.other.id)], "message", payload);
  const res: SendMessageResponse = { message: payload };
  return NextResponse.json(res);
});

// PATCH /api/chat/messages { messageId, content } -> { message } (sender only)
export const PATCH = route("PATCH /api/chat/messages", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_edit_${user.id}`, 30, MINUTE, "Too many edits. Please wait a moment.");
  const body = await readJson<{ messageId: string; content: string; newContent: string }>(request, 64 * 1024);
  const messageId = requireUuid(body.messageId, "messageId");
  const text = validateText(body.content ?? body.newContent);

  const existing = check(
    await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", messageId).eq("sender_id", user.id).maybeSingle(),
    "load message for edit"
  ) as MessageRow | null;
  if (!existing) throw notFound("Message not found.");
  const ctx = await getConversationForUser(existing.conversation_id, user.id);

  const prev = decodeMessageContent(existing.content);
  const snapshot = prev.snapshot ?? (prev.legacyReply ? { sender_id: "", content: prev.legacyReply.content } : null);
  const updated = check(
    await supabase
      .from("messages")
      .update({ content: encodeMessageContent(text, prev.replyToId, snapshot), edited_at: new Date().toISOString() })
      .eq("id", messageId)
      .eq("sender_id", user.id)
      .select(MESSAGE_COLUMNS)
      .maybeSingle(),
    "edit message"
  ) as MessageRow | null;
  if (!updated) throw notFound("Message not found.");

  const [message] = await toChatMessages([updated], ctx.names);
  await broadcastEvent<EditedEvent>([convTopic(ctx.id)], "message_edited", message);
  return NextResponse.json({ message });
});

// DELETE /api/chat/messages { messageId } (also ?messageId=) -> { success: true } (sender only)
export const DELETE = route("DELETE /api/chat/messages", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`chat_delete_${user.id}`, 30, MINUTE, "Too many deletions. Please wait a moment.");
  let rawId: unknown = new URL(request.url).searchParams.get("messageId");
  if (!rawId) rawId = (await readJson<{ messageId: string }>(request)).messageId;
  const messageId = requireUuid(rawId, "messageId");

  const rows = check(
    await supabase.from("messages").delete().eq("id", messageId).eq("sender_id", user.id).select("id, conversation_id"),
    "delete message"
  ) as { id: string; conversation_id: string }[];
  if (!rows || rows.length === 0) throw notFound("Message not found.");

  await broadcastEvent<DeletedEvent>([convTopic(rows[0].conversation_id)], "message_deleted", { id: messageId });
  return NextResponse.json({ success: true as const });
});

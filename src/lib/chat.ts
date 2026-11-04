/** Server-side chat helpers: participant checks and row -> ChatMessage mapping. */
import { supabase } from "@/lib/supabase";
import { check, notFound } from "@/lib/http";
import { decodeMessageContent } from "@/lib/chat-format";
import { CHAT_REPLY_SNIPPET } from "@/lib/constants";
import type { ChatMessage, Conversation, ReplyRef } from "@/types/api";

export const MESSAGE_COLUMNS = "id, conversation_id, sender_id, content, created_at, edited_at, ephemeral";

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  ephemeral: boolean | null;
}

interface UserRef {
  id: string;
  username: string;
  last_seen_at?: string | null;
}

export interface ConversationContext {
  id: string;
  save_messages: boolean;
  me: UserRef;
  other: UserRef;
  /** id -> username for both participants */
  names: Map<string, string>;
}

type JoinedUser = UserRef | UserRef[] | null;
const one = (u: JoinedUser): UserRef | null => (Array.isArray(u) ? u[0] ?? null : u);

/** Loads a conversation the user participates in (404 otherwise) with both usernames. */
export async function getConversationForUser(conversationId: string, userId: string): Promise<ConversationContext> {
  const data = check(
    await supabase
      .from("conversations")
      .select(
        "id, save_messages, user1_id, user2_id, user1:users!conversations_user1_id_fkey(id, username), user2:users!conversations_user2_id_fkey(id, username)"
      )
      .eq("id", conversationId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .maybeSingle(),
    "load conversation"
  ) as {
    id: string;
    save_messages: boolean | null;
    user1_id: string;
    user2_id: string;
    user1: JoinedUser;
    user2: JoinedUser;
  } | null;
  if (!data) throw notFound("Conversation not found.");
  const u1 = one(data.user1) ?? { id: data.user1_id, username: "Deleted user" };
  const u2 = one(data.user2) ?? { id: data.user2_id, username: "Deleted user" };
  const me = u1.id === userId ? u1 : u2;
  const other = u1.id === userId ? u2 : u1;
  return {
    id: data.id,
    save_messages: !!data.save_messages,
    me,
    other,
    names: new Map([
      [u1.id, u1.username],
      [u2.id, u2.username],
    ]),
  };
}

export function toConversation(ctx: { id: string; save_messages: boolean; other: UserRef }): Conversation {
  return {
    id: ctx.id,
    save_messages: ctx.save_messages,
    other_user: { id: ctx.other.id, username: ctx.other.username, last_seen_at: ctx.other.last_seen_at ?? null },
  };
}

/** Normalizes a conversations row joined with both users into a Conversation for `userId`. */
export function conversationFromJoinedRow(
  row: { id: string; save_messages: boolean | null; user1_id: string; user2_id: string; user1: JoinedUser; user2: JoinedUser },
  userId: string
): Conversation {
  const u1 = one(row.user1) ?? { id: row.user1_id, username: "Deleted user" };
  const u2 = one(row.user2) ?? { id: row.user2_id, username: "Deleted user" };
  const other = u1.id === userId ? u2 : u1;
  return {
    id: row.id,
    save_messages: !!row.save_messages,
    other_user: { id: other.id, username: other.username, last_seen_at: other.last_seen_at ?? null },
  };
}

const snippet = (s: string) => (s.length > CHAT_REPLY_SNIPPET ? `${s.slice(0, CHAT_REPLY_SNIPPET)}…` : s);

/**
 * Maps message rows to ChatMessage, resolving sender names and reply quotes from the
 * DB (quoted messages must belong to the same conversation).
 */
export async function toChatMessages(rows: MessageRow[], names: Map<string, string>): Promise<ChatMessage[]> {
  const decoded = rows.map((r) => ({ row: r, d: decodeMessageContent(r.content) }));
  const replyIds = Array.from(new Set(decoded.map((x) => x.d.replyToId).filter((x): x is string => !!x)));
  const byId = new Map<string, MessageRow>();
  for (const x of decoded) byId.set(x.row.id, x.row);

  const missing = replyIds.filter((id) => !byId.has(id));
  if (missing.length > 0 && rows.length > 0) {
    const convIds = Array.from(new Set(rows.map((r) => r.conversation_id)));
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .in("id", missing.slice(0, 500))
      .in("conversation_id", convIds);
    if (error) console.error("[chat] reply lookup failed:", error);
    for (const r of (data ?? []) as MessageRow[]) byId.set(r.id, r);
  }

  const nameOf = (id: string) => names.get(id) ?? "Unknown";

  return decoded.map(({ row, d }) => {
    let reply_to: ReplyRef | null = null;
    if (d.replyToId) {
      const target = byId.get(d.replyToId);
      if (target && target.conversation_id === row.conversation_id) {
        reply_to = {
          id: target.id,
          sender_id: target.sender_id,
          sender_name: nameOf(target.sender_id),
          content: snippet(decodeMessageContent(target.content).text),
        };
      } else if (d.snapshot) {
        reply_to = {
          id: d.replyToId,
          sender_id: d.snapshot.sender_id,
          sender_name: nameOf(d.snapshot.sender_id),
          content: d.snapshot.content,
        };
      } else if (d.legacyReply) {
        reply_to = {
          id: d.legacyReply.id,
          sender_id: "",
          sender_name: d.legacyReply.sender_name || "Unknown",
          content: snippet(d.legacyReply.content),
        };
      } else {
        reply_to = { id: d.replyToId, sender_id: "", sender_name: "", content: "Original message unavailable" };
      }
    }
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      sender_name: nameOf(row.sender_id),
      content: d.text,
      reply_to,
      ephemeral: !!row.ephemeral,
      created_at: row.created_at,
      edited_at: row.edited_at ?? null,
    };
  });
}

export { snippet as replySnippet };

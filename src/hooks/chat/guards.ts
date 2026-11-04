import type { ChatMessage, Conversation, ConversationListItem, PresencePayload, ReplyRef } from "@/types/api";

/**
 * Runtime validation for everything that arrives over the network (realtime payloads and
 * API responses). Anything malformed is dropped rather than trusted.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function isReplyRef(v: unknown): v is ReplyRef {
  return (
    isObj(v) && isNonEmptyStr(v.id) && isStr(v.sender_id) && isStr(v.sender_name) && isStr(v.content)
  );
}

export function isChatMessage(v: unknown): v is ChatMessage {
  if (!isObj(v)) return false;
  return (
    isNonEmptyStr(v.id) &&
    isNonEmptyStr(v.conversation_id) &&
    isNonEmptyStr(v.sender_id) &&
    isStr(v.sender_name) &&
    isStr(v.content) &&
    (v.reply_to === null || v.reply_to === undefined || isReplyRef(v.reply_to)) &&
    typeof v.ephemeral === "boolean" &&
    isNonEmptyStr(v.created_at) &&
    !Number.isNaN(Date.parse(v.created_at)) &&
    (v.edited_at === undefined || v.edited_at === null || isStr(v.edited_at))
  );
}

/** Normalise optional fields so the rest of the UI can rely on them. */
export function normalizeMessage(m: ChatMessage): ChatMessage {
  return { ...m, reply_to: m.reply_to ?? null, edited_at: m.edited_at ?? null };
}

const isIsoOrNull = (v: unknown): v is string | null =>
  v === null || (isNonEmptyStr(v) && !Number.isNaN(Date.parse(v)));

/** `other_user.last_seen_at` may be absent (older server); normalizeConversation fills it in. */
export function isConversation(v: unknown): v is Conversation {
  return (
    isObj(v) &&
    isNonEmptyStr(v.id) &&
    typeof v.save_messages === "boolean" &&
    isObj(v.other_user) &&
    isNonEmptyStr(v.other_user.id) &&
    isStr(v.other_user.username) &&
    (v.other_user.last_seen_at === undefined || isIsoOrNull(v.other_user.last_seen_at))
  );
}

export function normalizeConversation(c: Conversation): Conversation {
  return { id: c.id, save_messages: c.save_messages, other_user: { ...c.other_user, last_seen_at: c.other_user.last_seen_at ?? null } };
}

/** List item; `recent_incoming_ids` may be absent (older server) and defaults to []. */
export function isConversationListItem(v: unknown): v is ConversationListItem {
  if (!isConversation(v)) return false;
  const ids = (v as unknown as Obj).recent_incoming_ids;
  return ids === undefined || (Array.isArray(ids) && ids.every(isNonEmptyStr));
}

export function normalizeConversationListItem(c: ConversationListItem): ConversationListItem {
  return { ...normalizeConversation(c), recent_incoming_ids: Array.isArray(c.recent_incoming_ids) ? c.recent_incoming_ids : [] };
}

export function isPresencePayload(v: unknown): v is PresencePayload {
  return (
    isObj(v) &&
    isNonEmptyStr(v.user_id) &&
    typeof v.online === "boolean" &&
    isIsoOrNull(v.last_seen_at) &&
    // Consistent shape only: online carries a timestamp, offline carries null.
    (v.online ? v.last_seen_at !== null : v.last_seen_at === null)
  );
}

export function isIdPayload(v: unknown): v is { id: string } {
  return isObj(v) && isNonEmptyStr(v.id);
}

export function isIdsPayload(v: unknown): v is { ids: string[] } {
  return isObj(v) && Array.isArray(v.ids) && v.ids.every(isNonEmptyStr);
}

export function isSettingsPayload(v: unknown): v is { save_messages: boolean; changed_by: string } {
  return isObj(v) && typeof v.save_messages === "boolean" && isNonEmptyStr(v.changed_by);
}

/** Pull a validated array out of `{ [key]: unknown[] }`, dropping invalid items. */
export function pickArray<T>(data: unknown, key: string, guard: (v: unknown) => v is T): T[] | null {
  if (!isObj(data) || !Array.isArray(data[key])) return null;
  return (data[key] as unknown[]).filter(guard);
}

export function pickItem<T>(data: unknown, key: string, guard: (v: unknown) => v is T): T | null {
  if (!isObj(data)) return null;
  const item = data[key];
  return guard(item) ? item : null;
}

export function pickError(data: unknown): { error: string | null; code: string | null } {
  if (!isObj(data)) return { error: null, code: null };
  return { error: isStr(data.error) ? data.error : null, code: isStr(data.code) ? data.code : null };
}

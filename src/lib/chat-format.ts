/**
 * Message content envelope (pure, unit tested).
 *
 * New messages are ALWAYS stored as a versioned envelope, so user text that happens
 * to look like JSON can never be mistaken for metadata:
 *   {"v":1,"text":"...","reply_to_id":"<uuid>|null","reply_snapshot":{"sender_id","content"}|null}
 * `reply_snapshot` is written by the server (never by the client) and is only used
 * when the quoted message no longer exists.
 *
 * Legacy rows are still read: plain strings, and {"text","reply_to":{id,content,sender_name}}.
 */

export interface ReplySnapshot {
  sender_id: string;
  content: string;
}

export interface DecodedContent {
  text: string;
  replyToId: string | null;
  snapshot: ReplySnapshot | null;
  /** Only for legacy rows that embedded the quote. */
  legacyReply: { id: string; content: string; sender_name: string } | null;
}

export interface EnvelopeV1 {
  v: 1;
  text: string;
  reply_to_id: string | null;
  reply_snapshot?: ReplySnapshot | null;
}

export function encodeMessageContent(text: string, replyToId: string | null = null, snapshot: ReplySnapshot | null = null): string {
  const env: EnvelopeV1 = { v: 1, text, reply_to_id: replyToId };
  if (replyToId && snapshot) env.reply_snapshot = snapshot;
  return JSON.stringify(env);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function decodeMessageContent(raw: unknown): DecodedContent {
  const plain = (text: string): DecodedContent => ({ text, replyToId: null, snapshot: null, legacyReply: null });
  if (typeof raw !== "string") return plain("");
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("{")) return plain(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return plain(raw);
  }
  if (!isObj(parsed)) return plain(raw);

  if (parsed.v === 1 && typeof parsed.text === "string") {
    const replyToId = typeof parsed.reply_to_id === "string" && parsed.reply_to_id ? parsed.reply_to_id : null;
    const snap = parsed.reply_snapshot;
    const snapshot =
      replyToId && isObj(snap) && typeof snap.sender_id === "string" && typeof snap.content === "string"
        ? { sender_id: snap.sender_id, content: snap.content }
        : null;
    return { text: parsed.text, replyToId, snapshot, legacyReply: null };
  }

  // Legacy reply format: exactly {"text": string, "reply_to": {id, content, sender_name?}}
  const keys = Object.keys(parsed);
  const rt = parsed.reply_to;
  if (
    typeof parsed.text === "string" &&
    keys.length === 2 &&
    keys.includes("reply_to") &&
    isObj(rt) &&
    typeof rt.id === "string" &&
    typeof rt.content === "string"
  ) {
    return {
      text: parsed.text,
      replyToId: rt.id,
      snapshot: null,
      legacyReply: {
        id: rt.id,
        content: rt.content,
        sender_name: typeof rt.sender_name === "string" ? rt.sender_name : "",
      },
    };
  }

  return plain(raw);
}

/** Canonical ordering for a conversation's participant pair (matches CHECK user1_id < user2_id). */
export function orderParticipants(a: string, b: string): [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

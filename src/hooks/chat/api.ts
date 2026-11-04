import type { ChatMessage, Conversation, ConversationListItem, PresenceResponse } from "@/types/api";
import type { PresenceState } from "@/lib/presence";
import {
  isChatMessage,
  isConversation,
  isConversationListItem,
  normalizeConversation,
  normalizeConversationListItem,
  normalizeMessage,
  pickArray,
  pickError,
  pickItem,
} from "./guards";

/** Typed client for the chat API routes (contract: src/types/api.ts). */

export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Human-readable message for toasts / inline errors. */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ChatApiError) {
    if (err.status === 429 || err.code === "rate_limited") return "You're doing that too often. Wait a moment and try again.";
    if (err.status === 401) return "Your session has expired. Sign in again.";
    if (err.status >= 400 && err.status < 500 && err.message) return err.message;
    return fallback;
  }
  if (err instanceof TypeError) return "Can't reach the server. Check your connection.";
  return fallback;
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", ...init });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const { error, code } = pickError(data);
    throw new ChatApiError(error ?? `Request failed (${res.status})`, res.status, code);
  }
  return data;
}

const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

function invalid(): never {
  throw new ChatApiError("Unexpected response from server", 500, "invalid_response");
}

export async function fetchConversations(signal?: AbortSignal): Promise<ConversationListItem[]> {
  const data = await request("/api/chat/conversations", { signal });
  const list = pickArray(data, "conversations", isConversationListItem) ?? invalid();
  return list.map(normalizeConversationListItem);
}

export async function createConversation(username: string, saveMessages: boolean): Promise<Conversation> {
  const data = await request("/api/chat/conversations", json("POST", { username, saveMessages }));
  return normalizeConversation(pickItem(data, "conversation", isConversation) ?? invalid());
}

/**
 * POST /api/chat/presence. Resolves to null on any failure (presence is best-effort).
 * `keepalive` lets the request outlive the page (pagehide / tab hidden / sign-out).
 */
export async function postPresence(state: PresenceState, opts: { keepalive?: boolean } = {}): Promise<PresenceResponse | null> {
  try {
    const res = await fetch("/api/chat/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
      cache: "no-store",
      keepalive: opts.keepalive === true,
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    if (typeof data !== "object" || data === null) return null;
    const d = data as { online?: unknown; server_time?: unknown };
    if (typeof d.online !== "boolean" || typeof d.server_time !== "string" || Number.isNaN(Date.parse(d.server_time))) return null;
    return { online: d.online, server_time: d.server_time };
  } catch {
    // keepalive fetch unsupported or blocked: fall back to a beacon (fire and forget).
    if (opts.keepalive && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        navigator.sendBeacon("/api/chat/presence", JSON.stringify({ state }));
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

export async function fetchMessages(conversationId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  const data = await request(`/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`, { signal });
  const list = pickArray(data, "messages", isChatMessage) ?? invalid();
  return list.map(normalizeMessage);
}

export async function sendMessage(args: {
  conversationId: string;
  content: string;
  replyToId: string | null;
  clientId: string;
}): Promise<ChatMessage> {
  const body: Record<string, string> = {
    conversationId: args.conversationId,
    content: args.content,
    clientId: args.clientId,
  };
  if (args.replyToId) body.replyToId = args.replyToId;
  const data = await request("/api/chat/messages", json("POST", body));
  const msg = pickItem(data, "message", isChatMessage) ?? invalid();
  return normalizeMessage(msg);
}

export async function editMessage(messageId: string, content: string): Promise<ChatMessage> {
  const data = await request("/api/chat/messages", json("PATCH", { messageId, content }));
  const msg = pickItem(data, "message", isChatMessage) ?? invalid();
  return normalizeMessage(msg);
}

export async function deleteMessage(messageId: string): Promise<void> {
  await request("/api/chat/messages", json("DELETE", { messageId }));
}

export async function ackMessages(conversationId: string, messageIds: string[]): Promise<string[]> {
  const data = await request("/api/chat/messages/ack", json("POST", { conversationId, messageIds }));
  if (typeof data === "object" && data !== null && Array.isArray((data as { deleted?: unknown }).deleted)) {
    return ((data as { deleted: unknown[] }).deleted).filter((x): x is string => typeof x === "string");
  }
  return [];
}

/** Returns the server's resulting `save_messages` value. */
export async function toggleHistory(conversationId: string, saveMessages: boolean): Promise<boolean> {
  const data = await request("/api/chat/conversations/toggle", json("POST", { conversationId, saveMessages }));
  const conv = typeof data === "object" && data !== null ? (data as { conversation?: unknown }).conversation : null;
  if (typeof conv === "object" && conv !== null) {
    const value = (conv as { save_messages?: unknown }).save_messages;
    if (typeof value === "boolean") return value;
  }
  return saveMessages;
}

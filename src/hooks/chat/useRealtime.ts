"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { RealtimeClient } from "@supabase/realtime-js";
import type { ChatMessage, Conversation, PresencePayload } from "@/types/api";
import {
  acquireRealtime,
  convTopic,
  openPrivateChannel,
  releaseRealtime,
  userTopic,
  type ChannelStatus,
  type RealtimeChannel,
} from "@/lib/client/realtime";
import {
  isChatMessage,
  isConversation,
  isIdPayload,
  isIdsPayload,
  isPresencePayload,
  isSettingsPayload,
  normalizeConversation,
  normalizeMessage,
} from "./guards";

export type RealtimeState = "connecting" | "ready" | "unavailable";

const RETRY_MS = 60_000;

/**
 * Shared realtime client for the chat. Resolves to "unavailable" when the token endpoint
 * says realtime is unconfigured (503) or fails; retries in the background every minute.
 */
export function useRealtimeClient(): { client: RealtimeClient | null; state: RealtimeState } {
  const [result, setResult] = useState<{ client: RealtimeClient | null; state: RealtimeState }>({
    client: null,
    state: "connecting",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    void acquireRealtime().then((rt) => {
      if (!alive) return;
      if (rt) {
        setResult({ client: rt, state: "ready" });
      } else {
        setResult({ client: null, state: "unavailable" });
        retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      }
    });
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      releaseRealtime();
    };
  }, [attempt]);

  return result;
}

/** Channel status that automatically reads "connecting" for a topic we haven't heard from yet. */
function useTopicStatus(topic: string | null) {
  const [entry, setEntry] = useState<{ topic: string | null; status: ChannelStatus }>({
    topic: null,
    status: "connecting",
  });
  const status: ChannelStatus = entry.topic === topic ? entry.status : "connecting";
  return [status, setEntry] as const;
}

type BroadcastHandler = (payload: unknown) => void;

function listen(ch: RealtimeChannel, event: string, handler: BroadcastHandler) {
  ch.on("broadcast", { event }, (msg: { payload?: unknown }) => {
    const payload: unknown = msg.payload;
    handler(payload);
  });
}

export interface UserChannelHandlers {
  onMessage: (message: ChatMessage) => void;
  onConversation: (conversation: Conversation) => void;
  /** Server-authoritative presence of a conversation partner. */
  onPresence: (presence: PresencePayload) => void;
}

/** `swoshchat:user:<me>`: unread badges for any conversation, newly started chats, partner presence. */
export function useUserChannel(
  client: RealtimeClient | null,
  userId: string,
  handlers: UserChannelHandlers
): ChannelStatus {
  const topic = client && userId ? userTopic(userId) : null;
  const [status, setStatus] = useTopicStatus(topic);
  const onMessage = useEffectEvent((m: ChatMessage) => handlers.onMessage(m));
  const onConversation = useEffectEvent((c: Conversation) => handlers.onConversation(c));
  const onPresence = useEffectEvent((p: PresencePayload) => handlers.onPresence(p));

  useEffect(() => {
    if (!client || !topic) return;
    return openPrivateChannel(client, topic, {
      configure: (ch) => {
        listen(ch, "message", (p) => {
          if (isChatMessage(p)) onMessage(normalizeMessage(p));
        });
        listen(ch, "conversation", (p) => {
          if (isConversation(p)) onConversation(normalizeConversation(p));
        });
        listen(ch, "presence", (p) => {
          if (isPresencePayload(p) && p.user_id !== userId) onPresence(p);
        });
      },
      onStatus: (s) => setStatus({ topic, status: s }),
    });
  }, [client, topic, userId, setStatus]);

  return status;
}

export interface ConversationChannelHandlers {
  onMessage: (message: ChatMessage) => void;
  onEdited: (message: ChatMessage) => void;
  onDeleted: (id: string) => void;
  onConsumed: (ids: string[]) => void;
  onSettings: (saveMessages: boolean, changedBy: string) => void;
}

/**
 * `swoshchat:conv:<id>`. One channel per open conversation; removed when the id changes
 * and on unmount. Events for other conversations are ignored.
 */
export function useConversationChannel(
  client: RealtimeClient | null,
  conversationId: string,
  handlers: ConversationChannelHandlers
): ChannelStatus {
  const topic = client ? convTopic(conversationId) : null;
  const [status, setStatus] = useTopicStatus(topic);
  const onMessage = useEffectEvent((m: ChatMessage) => handlers.onMessage(m));
  const onEdited = useEffectEvent((m: ChatMessage) => handlers.onEdited(m));
  const onDeleted = useEffectEvent((id: string) => handlers.onDeleted(id));
  const onConsumed = useEffectEvent((ids: string[]) => handlers.onConsumed(ids));
  const onSettings = useEffectEvent((save: boolean, by: string) => handlers.onSettings(save, by));

  useEffect(() => {
    if (!client || !topic) return;
    const forThisConv = (p: unknown): p is ChatMessage => isChatMessage(p) && p.conversation_id === conversationId;
    return openPrivateChannel(client, topic, {
      configure: (ch) => {
        listen(ch, "message", (p) => {
          if (forThisConv(p)) onMessage(normalizeMessage(p));
        });
        listen(ch, "message_edited", (p) => {
          if (forThisConv(p)) onEdited(normalizeMessage(p));
        });
        listen(ch, "message_deleted", (p) => {
          if (isIdPayload(p)) onDeleted(p.id);
        });
        listen(ch, "messages_consumed", (p) => {
          if (isIdsPayload(p) && p.ids.length > 0) onConsumed(p.ids);
        });
        listen(ch, "settings", (p) => {
          if (isSettingsPayload(p)) onSettings(p.save_messages, p.changed_by);
        });
      },
      onStatus: (s) => setStatus({ topic, status: s }),
    });
  }, [client, topic, conversationId, setStatus]);

  return status;
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true
  );
}

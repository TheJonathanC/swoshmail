"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { RealtimeClient } from "@supabase/realtime-js";
import type { ChatMessage, Conversation, ReplyRef } from "@/types/api";
import { useToast } from "@/components/ui/Toast";
import { newClientId } from "@/components/chat/format";
import {
  ChatApiError,
  ackMessages,
  deleteMessage,
  describeError,
  editMessage,
  fetchMessages,
  isAbortError,
  sendMessage,
  toggleHistory,
} from "./api";
import { initialMessagesState, messagesReducer, type UiMessage } from "./messagesReducer";
import { useConversationChannel, type RealtimeState } from "./useRealtime";
import type { ChannelStatus } from "@/lib/client/realtime";

const POLL_MS = 4_000;
const ACK_DEBOUNCE_MS = 500;

export interface UseConversationArgs {
  client: RealtimeClient | null;
  realtimeState: RealtimeState;
  conversation: Conversation;
  userId: string;
  username: string;
  /** Called when save_messages changes (optimistic, confirmed, rolled back or remote). */
  onSaveMessagesChange: (conversationId: string, saveMessages: boolean) => void;
  /** New message from the other user (realtime or poll), for unread counting. */
  onIncoming: (message: ChatMessage) => void;
}

/**
 * Everything for one open conversation: history load (abortable, merged with realtime),
 * the private realtime channel, polling fallback, optimistic send/edit/delete with rollback,
 * read acks for disappearing messages and the history-mode toggle.
 * Mount it under a component keyed by conversation id so state never leaks between chats.
 */
export function useConversation({
  client,
  realtimeState,
  conversation,
  userId,
  username,
  onSaveMessagesChange,
  onIncoming,
}: UseConversationArgs) {
  const toast = useToast();
  const [state, dispatch] = useReducer(messagesReducer, initialMessagesState);
  const convId = conversation.id;
  const otherName = conversation.other_user.username;

  // Latest callbacks for async code (avoids re-creating loaders on every parent render).
  const callbacksRef = useRef({ onSaveMessagesChange, onIncoming });
  useEffect(() => {
    callbacksRef.current = { onSaveMessagesChange, onIncoming };
  });

  const knownIdsRef = useRef<Set<string>>(new Set());
  const loadedOnceRef = useRef(false);
  const seqRef = useRef(0);
  const localToggleRef = useRef<boolean | null>(null);

  const settingsNotice = useCallback(
    (who: string, saveMessages: boolean) => {
      const now = Date.now();
      dispatch({
        type: "notice",
        notice: {
          id: `settings-${now}-${saveMessages ? 1 : 0}`,
          kind: "settings",
          at: new Date(now).toISOString(),
          count: 1,
          text: saveMessages
            ? `${who} turned on Keep History. New messages are saved (latest 100).`
            : `${who} turned off Keep History. New messages are deleted after they're read.`,
        },
      });
    },
    []
  );

  const noteIncoming = useCallback(
    (m: ChatMessage) => {
      if (m.sender_id === userId) return;
      if (knownIdsRef.current.has(m.id)) return;
      knownIdsRef.current.add(m.id);
      callbacksRef.current.onIncoming(m);
    },
    [userId]
  );

  // ---------------------------------------------------------------- realtime
  const channelStatus: ChannelStatus = useConversationChannel(client, convId, {
    onMessage: (m) => {
      dispatch({ type: "upsert", message: m, now: Date.now(), myId: userId });
      noteIncoming(m);
    },
    onEdited: (m) => dispatch({ type: "upsert", message: m, now: Date.now(), myId: userId }),
    onDeleted: (id) =>
      dispatch({ type: "remove", ids: [id], reason: "deleted", myId: userId, at: new Date().toISOString(), noticeId: "" }),
    onConsumed: (ids) => {
      const now = Date.now();
      dispatch({
        type: "remove",
        ids,
        reason: "consumed",
        myId: userId,
        at: new Date(now).toISOString(),
        noticeId: `consumed-${now}`,
      });
    },
    onSettings: (saveMessages, changedBy) => {
      callbacksRef.current.onSaveMessagesChange(convId, saveMessages);
      if (changedBy === userId) {
        if (localToggleRef.current === saveMessages) {
          localToggleRef.current = null; // our own toggle, already announced locally
          return;
        }
        settingsNotice("You", saveMessages);
      } else {
        settingsNotice(otherName, saveMessages);
      }
    },
  });

  const live = client !== null && channelStatus === "live";
  const polling = realtimeState === "unavailable" || (client !== null && channelStatus === "failed");

  // ---------------------------------------------------------------- loading
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const seq = ++seqRef.current;
      const requestStartedAt = Date.now();
      try {
        const messages = await fetchMessages(convId, signal);
        if (signal?.aborted || seq !== seqRef.current) return;
        const firstLoad = !loadedOnceRef.current;
        loadedOnceRef.current = true;
        dispatch({ type: "load_success", messages, requestStartedAt, now: Date.now(), myId: userId });
        for (const m of messages) {
          if (firstLoad) knownIdsRef.current.add(m.id);
          else noteIncoming(m);
        }
      } catch (err) {
        if (isAbortError(err) || signal?.aborted || seq !== seqRef.current) return;
        dispatch({ type: "load_error" });
      }
    },
    [convId, userId, noteIncoming]
  );

  // Initial load, and a catch-up reload whenever the live channel (re)connects or drops.
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, live]);

  // Polling fallback while realtime is unavailable.
  useEffect(() => {
    if (!polling) return;
    let ctrl: AbortController | null = null;
    const timer = setInterval(() => {
      if (ctrl) return; // previous poll still running
      const c = new AbortController();
      ctrl = c;
      void load(c.signal).finally(() => {
        if (ctrl === c) ctrl = null;
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      ctrl?.abort();
    };
  }, [polling, load]);

  const reload = useCallback(() => {
    dispatch({ type: "load_start" });
    void load();
  }, [load]);

  // ---------------------------------------------------------------- sending
  const post = useCallback(
    async (m: UiMessage) => {
      if (!m.clientId) return;
      try {
        const saved = await sendMessage({
          conversationId: convId,
          content: m.content,
          replyToId: m.replyToId,
          clientId: m.clientId,
        });
        knownIdsRef.current.add(saved.id);
        dispatch({ type: "send_success", clientId: m.clientId, message: saved, now: Date.now() });
      } catch (err) {
        dispatch({ type: "send_fail", clientId: m.clientId });
        toast("danger", "Message not sent", describeError(err, "Tap Retry on the message to send it again."));
      }
    },
    [convId, toast]
  );

  const send = useCallback(
    (content: string, replyTo: ReplyRef | null) => {
      const clientId = newClientId();
      const optimistic: UiMessage = {
        id: clientId,
        key: clientId,
        clientId,
        conversation_id: convId,
        sender_id: userId,
        sender_name: username,
        content,
        reply_to: replyTo,
        replyToId: replyTo?.id ?? null,
        ephemeral: !conversation.save_messages,
        created_at: new Date().toISOString(),
        edited_at: null,
        status: "sending",
        syncedAt: 0,
        acked: false,
        editRollback: null,
      };
      dispatch({ type: "send_start", message: optimistic });
      void post(optimistic);
    },
    [convId, userId, username, conversation.save_messages, post]
  );

  const retry = useCallback(
    (m: UiMessage) => {
      if (!m.clientId || m.status !== "failed") return;
      dispatch({ type: "retry", clientId: m.clientId });
      void post({ ...m, status: "sending" });
    },
    [post]
  );

  const discard = useCallback((m: UiMessage) => {
    if (m.clientId) dispatch({ type: "discard", clientId: m.clientId });
  }, []);

  // ---------------------------------------------------------------- edit / delete
  const edit = useCallback(
    async (m: UiMessage, content: string) => {
      // Unsynced messages have no server id yet; the UI hides Edit until they sync.
      if (m.status !== "sent" || m.editRollback || content === m.content) return;
      dispatch({ type: "edit_start", id: m.id, content });
      try {
        const saved = await editMessage(m.id, content);
        dispatch({ type: "edit_success", message: saved, now: Date.now() });
      } catch (err) {
        dispatch({ type: "edit_fail", id: m.id });
        toast("danger", "Edit not saved", describeError(err, "Your message was restored. Try again."));
      }
    },
    [toast]
  );

  const remove = useCallback(
    async (m: UiMessage) => {
      if (m.status !== "sent") {
        discard(m);
        return;
      }
      dispatch({ type: "delete_start", id: m.id });
      try {
        await deleteMessage(m.id);
        dispatch({ type: "delete_success", id: m.id });
      } catch (err) {
        if (err instanceof ChatApiError && err.status === 404) {
          // Already gone on the server (consumed or deleted elsewhere).
          dispatch({ type: "delete_success", id: m.id });
          return;
        }
        dispatch({ type: "delete_fail", id: m.id });
        toast("danger", "Message not deleted", describeError(err, "The message was restored. Try again."));
      }
    },
    [discard, toast]
  );

  // ---------------------------------------------------------------- history toggle
  const setKeepHistory = useCallback(
    async (next: boolean): Promise<void> => {
      const prev = conversation.save_messages;
      if (prev === next) return;
      callbacksRef.current.onSaveMessagesChange(convId, next);
      localToggleRef.current = next;
      try {
        const confirmed = await toggleHistory(convId, next);
        callbacksRef.current.onSaveMessagesChange(convId, confirmed);
        settingsNotice("You", confirmed);
      } catch (err) {
        localToggleRef.current = null;
        callbacksRef.current.onSaveMessagesChange(convId, prev);
        toast("danger", "Setting not changed", describeError(err, "Keep History was not updated. Try again."));
      }
    },
    [conversation.save_messages, convId, settingsNotice, toast]
  );

  // ---------------------------------------------------------------- read acks (disappearing mode)
  const ackSentRef = useRef<Set<string>>(new Set());
  const ackQueueRef = useRef<Set<string>>(new Set());
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushAcks = useCallback(() => {
    ackTimerRef.current = null;
    const ids = [...ackQueueRef.current];
    ackQueueRef.current.clear();
    if (ids.length === 0) return;
    ids.forEach((id) => ackSentRef.current.add(id));
    ackMessages(convId, ids)
      .then(() => dispatch({ type: "acked", ids }))
      .catch(() => {
        // Allow a later sighting to retry.
        ids.forEach((id) => ackSentRef.current.delete(id));
      });
  }, [convId]);

  /** Called with ids of ephemeral messages from the other user that were actually displayed. */
  const markSeen = useCallback(
    (ids: string[]) => {
      let added = false;
      for (const id of ids) {
        if (ackSentRef.current.has(id) || ackQueueRef.current.has(id)) continue;
        ackQueueRef.current.add(id);
        added = true;
      }
      if (added && !ackTimerRef.current) ackTimerRef.current = setTimeout(flushAcks, ACK_DEBOUNCE_MS);
    },
    [flushAcks]
  );

  // Flush pending acks when leaving the conversation.
  useEffect(
    () => () => {
      if (ackTimerRef.current) {
        clearTimeout(ackTimerRef.current);
        flushAcks();
      }
    },
    [flushAcks]
  );

  return {
    state,
    live,
    polling,
    reload,
    send,
    retry,
    discard,
    edit,
    remove,
    setKeepHistory,
    markSeen,
  };
}

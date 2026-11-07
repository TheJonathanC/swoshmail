"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation, ConversationListItem } from "@/types/api";
import { MessageIcon } from "./Icons";
import { fetchConversations, isAbortError } from "@/hooks/chat/api";
import { useDocumentVisible, useRealtimeClient, useUserChannel } from "@/hooks/chat/useRealtime";
import { usePartnerPresence, usePresenceHeartbeat } from "@/hooks/chat/usePresence";
import { collectNewIncoming, seedSeenIds } from "@/hooks/chat/unread";
import ConversationList, { conversationButtonId } from "./chat/ConversationList";
import ConversationView from "./chat/ConversationView";
import NewChatForm from "./chat/NewChatForm";

const CONVERSATIONS_POLL_MS = 20_000;

export interface ChatPanelProps {
  userId: string;
  username: string;
  /** Chat tab is currently shown. The panel stays mounted while hidden. */
  active?: boolean;
  /** Total unread messages across all conversations (for the nav badge / tab title). */
  onUnreadChange?: (total: number) => void;
}

/**
 * Swosh Chat entry point (loaded with next/dynamic from page.tsx).
 * Owns the conversation list, unread counts, realtime client, presence and the
 * user-level channel. Each open conversation is a keyed <ConversationView>.
 *
 * Unread counting: every incoming message id is counted at most once (`countedRef`),
 * whichever path sees it first: the user channel (realtime), the open conversation's
 * loads, or, while live updates are down, `recent_incoming_ids` from the polled
 * conversation list. Ids present on the first list load are seeded as already seen.
 */
export default function ChatPanel({ userId, username, active = true, onUnreadChange }: ChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoad, setConvLoad] = useState<"loading" | "error" | "ready">("loading");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});

  const visible = useDocumentVisible();
  const viewing = active && visible;
  const viewedId = viewing ? activeId : null;

  const rt = useRealtimeClient();
  const presence = usePartnerPresence();
  usePresenceHeartbeat(userId, presence.setSkew);

  const activeConv = activeId ? (conversations.find((c) => c.id === activeId) ?? null) : null;

  // ---------------------------------------------------------------- conversations
  /** Incoming message ids already counted (or seeded as pre-existing). Shared by every path. */
  const countedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  /** Mirrors of render values for the list callback (kept stable for its callers). */
  const pollingRef = useRef(false);
  const viewedIdRef = useRef<string | null>(null);

  /** Polling-mode unread counting from `recent_incoming_ids`. */
  const countFromList = useCallback((list: readonly ConversationListItem[]) => {
    if (!seededRef.current) {
      seededRef.current = true;
      seedSeenIds(list, countedRef.current);
      return;
    }
    // Realtime mode: the user channel counts; leave unseen ids for a later polling pass.
    if (!pollingRef.current) return;
    const added = collectNewIncoming(list, countedRef.current, viewedIdRef.current);
    if (Object.keys(added).length === 0) return;
    setUnread((prev) => {
      const next = { ...prev };
      for (const [id, n] of Object.entries(added)) next[id] = (next[id] ?? 0) + n;
      return next;
    });
  }, []);

  const applyPresenceList = presence.applyList;
  // Request-id guard: only the newest request may update the list.
  const convSeqRef = useRef(0);
  const loadConversations = useCallback((signal?: AbortSignal): Promise<void> => {
    const seq = ++convSeqRef.current;
    return fetchConversations(signal).then(
      (list) => {
        if (seq !== convSeqRef.current) return;
        setConversations(list);
        setConvLoad("ready");
        applyPresenceList(list);
        countFromList(list);
      },
      (err: unknown) => {
        if (isAbortError(err) || seq !== convSeqRef.current) return;
        setConvLoad((prev) => (prev === "ready" ? prev : "error"));
      }
    );
  }, [applyPresenceList, countFromList]);

  useEffect(() => {
    const ctrl = new AbortController();
    void loadConversations(ctrl.signal);
    return () => ctrl.abort();
  }, [loadConversations]);

  const retryConversations = () => {
    setConvLoad("loading");
    void loadConversations();
  };

  const addConversation = useCallback(
    (conv: Conversation) => {
      setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
      applyPresenceList([conv]);
    },
    [applyPresenceList]
  );

  const setSaveMessages = useCallback((conversationId: string, saveMessages: boolean) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId && c.save_messages !== saveMessages ? { ...c, save_messages: saveMessages } : c))
    );
  }, []);

  // ---------------------------------------------------------------- unread
  const noteIncoming = (m: ChatMessage) => {
    if (m.sender_id === userId || countedRef.current.has(m.id)) return;
    countedRef.current.add(m.id);
    if (!conversations.some((c) => c.id === m.conversation_id)) void loadConversations();
    if (m.conversation_id === viewedId) return; // on screen right now
    setUnread((prev) => ({ ...prev, [m.conversation_id]: (prev[m.conversation_id] ?? 0) + 1 }));
  };

  const userStatus = useUserChannel(rt.client, userId, {
    onMessage: noteIncoming,
    onConversation: addConversation,
    onPresence: presence.applyEvent,
  });

  // Clear a conversation's badge as soon as it is actually being viewed.
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  if (viewedId !== clearedFor) {
    setClearedFor(viewedId);
    if (viewedId && unread[viewedId]) setUnread((prev) => ({ ...prev, [viewedId]: 0 }));
  }

  const totalUnread = Object.entries(unread).reduce((sum, [id, n]) => (id === viewedId ? sum : sum + n), 0);
  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [totalUnread, onUnreadChange]);

  // ---------------------------------------------------------------- fallback polling
  const liveDown = rt.state === "unavailable" || (rt.client !== null && userStatus === "failed");

  useEffect(() => {
    pollingRef.current = liveDown;
    viewedIdRef.current = viewedId;
  }, [liveDown, viewedId]);

  useEffect(() => {
    if (!liveDown) return;
    const timer = setInterval(() => void loadConversations(), CONVERSATIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [liveDown, loadConversations]);

  // ---------------------------------------------------------------- navigation
  const openConversation = (conv: Conversation) => {
    setActiveId(conv.id);
    setUnread((prev) => (prev[conv.id] ? { ...prev, [conv.id]: 0 } : prev));
  };

  const handleCreated = (conv: Conversation) => {
    addConversation(conv);
    openConversation(conv);
  };

  const handleBack = () => {
    const id = activeId;
    setActiveId(null);
    // Return focus to the conversation we came from (mobile list/detail).
    if (id) requestAnimationFrame(() => document.getElementById(conversationButtonId(id))?.focus());
  };

  return (
    <div className={`chat-layout ${activeConv ? "chat-active" : "chat-list-view"}`}>
      <aside className="chat-sidebar" aria-label="Chats">
        <NewChatForm onCreated={handleCreated} />
        <ConversationList
          conversations={conversations}
          load={convLoad}
          onRetry={retryConversations}
          activeId={activeId}
          unread={unread}
          online={presence.online}
          presenceKnown={presence.known}
          onOpen={openConversation}
        />
      </aside>

      <section className="chat-window" aria-label={activeConv ? `Chat with ${activeConv.other_user.username}` : "Chat"}>
        {activeConv ? (
          <ConversationView
            key={activeConv.id}
            conversation={activeConv}
            userId={userId}
            username={username}
            client={rt.client}
            realtimeState={rt.state}
            active={active}
            viewing={viewing}
            online={presence.online.has(activeConv.other_user.id)}
            presenceKnown={presence.known}
            onBack={handleBack}
            onSaveMessagesChange={setSaveMessages}
            onIncoming={noteIncoming}
          />
        ) : (
          <div className="chat-empty-window">
            <MessageIcon size={40} />
            <p className="chat-empty-title">Select or start a conversation</p>
            <p className="chat-empty-hint">Enter a username under &ldquo;Start a new chat&rdquo; to begin.</p>
          </div>
        )}
      </section>
    </div>
  );
}

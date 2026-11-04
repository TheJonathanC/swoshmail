"use client";

import type { Conversation } from "@/types/api";
import { AlertCircleIcon, ClockIcon, HistoryIcon } from "@/components/Icons";

interface ConversationListProps {
  conversations: Conversation[];
  load: "loading" | "error" | "ready";
  onRetry: () => void;
  activeId: string | null;
  unread: Readonly<Record<string, number>>;
  online: ReadonlySet<string>;
  presenceKnown: boolean;
  onOpen: (conversation: Conversation) => void;
}

export function conversationButtonId(id: string) {
  return `chat-conv-${id}`;
}

export default function ConversationList({
  conversations,
  load,
  onRetry,
  activeId,
  unread,
  online,
  presenceKnown,
  onOpen,
}: ConversationListProps) {
  if (load === "loading" && conversations.length === 0) {
    return (
      <div className="chat-conversations-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <span>Loading conversations…</span>
      </div>
    );
  }

  if (load === "error" && conversations.length === 0) {
    return (
      <div className="callout callout-danger chat-load-error" role="alert">
        <AlertCircleIcon size={16} />
        <div>
          <p>Couldn&apos;t load your conversations.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return <p className="chat-conversations-state">No conversations yet.</p>;
  }

  return (
    <nav className="chat-conversations-nav" aria-label="Conversations">
      <ul className="chat-conversations-list">
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          const isOnline = online.has(conv.other_user.id);
          const count = unread[conv.id] ?? 0;
          return (
            <li key={conv.id}>
              <button
                type="button"
                id={conversationButtonId(conv.id)}
                onClick={() => onOpen(conv)}
                className={`chat-conv-item${isActive ? " active" : ""}`}
                aria-current={isActive ? "true" : undefined}
              >
                {presenceKnown && <span className={`online-dot${isOnline ? " active" : ""}`} aria-hidden="true" />}
                <span className="chat-conv-text">
                  <span className="chat-conv-name">{conv.other_user.username}</span>
                  {presenceKnown && <span className="sr-only">{isOnline ? ", online" : ", offline"}</span>}
                  <span className="chat-conv-mode">
                    {conv.save_messages ? <HistoryIcon size={11} /> : <ClockIcon size={11} />}
                    {conv.save_messages ? "History kept" : "Disappearing"}
                  </span>
                </span>
                {count > 0 && (
                  <span className="chat-unread-badge">
                    <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
                    <span className="sr-only">, {count} unread</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

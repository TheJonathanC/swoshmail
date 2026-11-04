"use client";

import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { StreamNotice, UiMessage } from "@/hooks/chat/messagesReducer";
import { useToast } from "@/components/ui/Toast";
import { AlertCircleIcon, ArrowDownIcon, EyeIcon, InfoIcon } from "@/components/Icons";
import MessageBubble, { messageAnchorId } from "./MessageBubble";
import { formatDateDivider, formatTime, isSameDay, scrollBehavior } from "./format";

const NEAR_BOTTOM_PX = 96;
const HIGHLIGHT_MS = 1600;

type StreamItem =
  | { kind: "message"; key: string; at: string; message: UiMessage }
  | { kind: "notice"; key: string; at: string; notice: StreamNotice };

interface MessageListProps {
  messages: UiMessage[];
  notices: StreamNotice[];
  load: "loading" | "error" | "ready";
  onRetryLoad: () => void;
  myId: string;
  otherName: string;
  /** Chat is the active tab and the document is visible. */
  viewing: boolean;
  onSeen: (ids: string[]) => void;
  menuOpenKey: string | null;
  onToggleMenu: (key: string | null) => void;
  onReply: (m: UiMessage) => void;
  onEdit: (m: UiMessage) => void;
  onDelete: (m: UiMessage) => void;
  onRetry: (m: UiMessage) => void;
  onDiscard: (m: UiMessage) => void;
}

function buildStream(messages: UiMessage[], notices: StreamNotice[]): StreamItem[] {
  const items: StreamItem[] = [
    ...messages.map((m) => ({ kind: "message" as const, key: m.key, at: m.created_at, message: m })),
    ...notices.map((n) => ({ kind: "notice" as const, key: n.id, at: n.at, notice: n })),
  ];
  // Messages are already sorted; a stable sort keeps their order and slots notices in by time.
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export default function MessageList({
  messages,
  notices,
  load,
  onRetryLoad,
  myId,
  otherName,
  viewing,
  onSeen,
  menuOpenKey,
  onToggleMenu,
  onReply,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
}: MessageListProps) {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const stream = buildStream(messages, notices);
  const last = messages[messages.length - 1];
  const lastKey = last?.key ?? null;

  // Count messages that arrive while the reader is scrolled up (adjust-state-during-render).
  const [trackedLastKey, setTrackedLastKey] = useState<string | null>(lastKey);
  if (lastKey !== trackedLastKey) {
    setTrackedLastKey(lastKey);
    if (!nearBottom && trackedLastKey !== null) {
      const from = messages.findIndex((m) => m.key === trackedLastKey);
      const added = messages.slice(from + 1).filter((m) => m.sender_id !== myId).length;
      if (added > 0) setUnseen((n) => n + added);
    }
  }

  // Auto-scroll only when already near the bottom, or when we just sent something.
  const followNewLast = useEffectEvent(() => {
    const el = scrollRef.current;
    if (!el || !last) return;
    const justSentByMe = last.sender_id === myId && last.status === "sending";
    if (nearBottom || justSentByMe) el.scrollTop = el.scrollHeight;
  });
  useLayoutEffect(() => {
    followNewLast();
  }, [lastKey]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isNear = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setNearBottom(isNear);
    if (isNear) setUnseen(0);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() });
    setUnseen(0);
  };

  const jumpTo = (messageId: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(messageAnchorId(messageId))}`);
    if (!el) {
      toast("info", "Message unavailable", "Original message is no longer available");
      return;
    }
    el.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    el.classList.remove("chat-bubble-highlight");
    // Restart the highlight even if it's already applied.
    void el.offsetWidth;
    el.classList.add("chat-bubble-highlight");
    window.setTimeout(() => el.classList.remove("chat-bubble-highlight"), HIGHLIGHT_MS);
  };

  // Ack ephemeral messages from the other user only once they are actually on screen
  // while the chat is visible. Re-created when candidates or visibility change; the
  // observer's initial callback reports elements already in view.
  const ackKey = messages
    .filter((m) => m.sender_id !== myId && m.ephemeral && m.status === "sent" && !m.acked)
    .map((m) => m.id)
    .join(",");
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !viewing || !ackKey || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const ids = entries
          .filter((e) => e.isIntersecting)
          .map((e) => (e.target as HTMLElement).dataset.ackId)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ids.length > 0) onSeen(ids);
      },
      { root, threshold: 0.6 }
    );
    root.querySelectorAll<HTMLElement>("[data-ack-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ackKey, viewing, onSeen]);

  if (load === "loading" && messages.length === 0) {
    return (
      <div className="chat-messages-container chat-messages-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p className="chat-state-text">Loading messages…</p>
      </div>
    );
  }

  if (load === "error" && messages.length === 0) {
    return (
      <div className="chat-messages-container chat-messages-state">
        <div className="callout callout-danger chat-load-error" role="alert">
          <AlertCircleIcon size={16} />
          <div>
            <p>Couldn&apos;t load messages with {otherName}.</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetryLoad}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-messages-wrap">
      <div
        ref={scrollRef}
        className="chat-messages-container"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`Messages with ${otherName}`}
        tabIndex={0}
        onScroll={onScroll}
        onClick={(e) => {
          if (menuOpenKey && !(e.target as HTMLElement).closest(".message-actions")) onToggleMenu(null);
        }}
      >
        {stream.length === 0 && (
          <div className="chat-empty-stream">
            <p>No messages yet. Say hello to {otherName}.</p>
          </div>
        )}
        {stream.map((item, index) => {
          const prev = stream[index - 1];
          const showDate = !prev || !isSameDay(item.at, prev.at);
          return (
            <Fragment key={item.key}>
              {showDate && (
                <div className="chat-date-separator">
                  <span className="chat-date-pill">{formatDateDivider(item.at)}</span>
                </div>
              )}
              {item.kind === "message" ? (
                <MessageBubble
                  message={item.message}
                  myId={myId}
                  menuOpen={menuOpenKey === item.message.key}
                  onToggleMenu={(key) => onToggleMenu(menuOpenKey === key ? null : key)}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                  onJump={jumpTo}
                />
              ) : (
                <p className={`chat-system-notice chat-system-notice-${item.notice.kind}`}>
                  {item.notice.kind === "consumed" ? <EyeIcon size={12} /> : <InfoIcon size={12} />}
                  <span>{item.notice.text}</span>
                  <time dateTime={item.notice.at} className="chat-system-notice-time">
                    {formatTime(item.notice.at)}
                  </time>
                </p>
              )}
            </Fragment>
          );
        })}
      </div>

      {unseen > 0 && !nearBottom && (
        <button type="button" className="chat-new-messages-pill" onClick={scrollToBottom}>
          {unseen === 1 ? "1 new message" : `${unseen} new messages`}
          <ArrowDownIcon size={14} />
        </button>
      )}
    </div>
  );
}

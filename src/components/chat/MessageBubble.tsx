"use client";

import type { UiMessage } from "@/hooks/chat/messagesReducer";
import { ClockIcon, EditIcon, MoreHorizontalIcon, RefreshCwIcon, ReplyIcon, TrashIcon } from "@/components/Icons";
import { formatFullDateTime, formatTime } from "./format";

interface MessageBubbleProps {
  message: UiMessage;
  myId: string;
  menuOpen: boolean;
  onToggleMenu: (key: string) => void;
  onReply: (m: UiMessage) => void;
  onEdit: (m: UiMessage) => void;
  onDelete: (m: UiMessage) => void;
  onRetry: (m: UiMessage) => void;
  onDiscard: (m: UiMessage) => void;
  onJump: (messageId: string) => void;
}

export function messageAnchorId(messageId: string) {
  return `chat-msg-${messageId}`;
}

export default function MessageBubble({
  message: m,
  myId,
  menuOpen,
  onToggleMenu,
  onReply,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
  onJump,
}: MessageBubbleProps) {
  const mine = m.sender_id === myId;
  const sender = mine ? "You" : m.sender_name;
  const synced = m.status === "sent";
  const quote = m.reply_to;
  const quoteSender = quote ? (quote.sender_id === myId ? "You" : quote.sender_name) : "";
  const canEdit = mine && synced && !m.editRollback;
  const ownerLabel = mine ? "your message" : `message from ${sender}`;

  return (
    <div
      className={`chat-message-row ${mine ? "mine" : "other"}${m.status === "failed" ? " failed" : ""}`}
      data-ack-id={!mine && m.ephemeral && synced && !m.acked ? m.id : undefined}
    >
      <div className="chat-bubble-stack">
        <div
          id={synced ? messageAnchorId(m.id) : undefined}
          className={`chat-bubble ${mine ? "mine" : "other"}${m.status === "sending" ? " is-sending" : ""}`}
        >
          <span className="sr-only">{sender}: </span>
          {quote && (
            <button
              type="button"
              className="chat-reply-quote"
              onClick={() => onJump(quote.id)}
              aria-label={`Quoted message from ${quoteSender}: ${quote.content}. Jump to original`}
            >
              <span className="chat-reply-quote-sender">
                <ReplyIcon size={11} /> {quoteSender}
              </span>
              <span className="chat-reply-quote-text">{quote.content}</span>
            </button>
          )}
          <p className="chat-bubble-text">{m.content}</p>
          <div className="chat-bubble-meta">
            {m.ephemeral && (
              <span className="chat-bubble-ephemeral" title="Disappearing message">
                <ClockIcon size={11} />
                <span className="sr-only">Disappearing message, </span>
              </span>
            )}
            <time dateTime={m.created_at} title={formatFullDateTime(m.created_at)}>
              {formatTime(m.created_at)}
            </time>
            {m.edited_at && synced && <span className="chat-bubble-edited">· Edited</span>}
            {m.status === "sending" && <span className="chat-bubble-status">· Sending…</span>}
          </div>
        </div>

        {m.status === "failed" && (
          <div className="chat-bubble-failed" role="status">
            <span>Not sent</span>
            <span aria-hidden="true">·</span>
            <button type="button" className="chat-inline-btn" onClick={() => onRetry(m)}>
              <RefreshCwIcon size={12} /> Retry
            </button>
            <button type="button" className="chat-inline-btn" onClick={() => onDiscard(m)}>
              Discard
            </button>
          </div>
        )}
      </div>

      {synced && (
        <div className={`message-actions${menuOpen ? " show-actions" : ""}`}>
          <button
            type="button"
            className="action-icon-btn message-more-btn"
            aria-label={`Actions for ${ownerLabel}`}
            aria-expanded={menuOpen}
            onClick={() => onToggleMenu(m.key)}
          >
            <MoreHorizontalIcon size={16} />
          </button>
          <div className="message-actions-list" role="group" aria-label={`Actions for ${ownerLabel}`}>
            <button
              type="button"
              className="action-icon-btn"
              onClick={() => onReply(m)}
              aria-label={mine ? "Reply to your message" : `Reply to message from ${sender}`}
              title="Reply"
            >
              <ReplyIcon size={14} />
            </button>
            {mine && (
              <>
                <button
                  type="button"
                  className="action-icon-btn"
                  onClick={() => onEdit(m)}
                  disabled={!canEdit}
                  aria-label="Edit your message"
                  title="Edit"
                >
                  <EditIcon size={14} />
                </button>
                <button
                  type="button"
                  className="action-icon-btn danger"
                  onClick={() => onDelete(m)}
                  aria-label="Delete your message"
                  title="Delete"
                >
                  <TrashIcon size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

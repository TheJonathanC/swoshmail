"use client";

import { useId, type FormEvent, type RefObject } from "react";
import type { ReplyRef } from "@/types/api";
import { CheckIcon, CloseIcon, EditIcon, ReplyIcon, SendIcon } from "@/components/Icons";
import { COUNTER_THRESHOLD, MAX_MESSAGE_LENGTH } from "./format";

interface ChatComposerProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  otherName: string;
  myId: string;
  replyingTo: ReplyRef | null;
  editing: boolean;
  onCancelReply: () => void;
  onCancelEdit: () => void;
}

export default function ChatComposer({
  inputRef,
  value,
  onChange,
  onSubmit,
  otherName,
  myId,
  replyingTo,
  editing,
  onCancelReply,
  onCancelEdit,
}: ChatComposerProps) {
  const inputId = useId();
  const counterId = useId();
  const length = value.length;
  const remaining = MAX_MESSAGE_LENGTH - length;
  const showCounter = length >= COUNTER_THRESHOLD;
  const replyName = replyingTo ? (replyingTo.sender_id === myId ? "yourself" : replyingTo.sender_name) : "";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit();
  };

  return (
    <div className="chat-composer">
      {editing && (
        <div className="chat-editing-banner">
          <div className="editing-banner-content">
            <EditIcon size={14} />
            <span>Editing your message</span>
          </div>
          <button type="button" className="editing-cancel-btn" onClick={onCancelEdit} title="Cancel editing (Esc)">
            <CloseIcon size={14} /> Cancel<span className="sr-only"> editing</span>
          </button>
        </div>
      )}

      {replyingTo && !editing && (
        <div className="chat-reply-banner">
          <div className="reply-banner-content">
            <div className="reply-banner-header">
              <ReplyIcon size={13} />
              <span>Replying to {replyName}</span>
            </div>
            <div className="reply-banner-text">{replyingTo.content}</div>
          </div>
          <button type="button" className="editing-cancel-btn" onClick={onCancelReply} title="Cancel reply (Esc)">
            <CloseIcon size={14} /> Cancel<span className="sr-only"> reply</span>
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="chat-input-bar">
        <div className="chat-input-wrapper">
          <label htmlFor={inputId} className="sr-only">
            {editing ? "Edit your message" : replyingTo ? `Reply to ${replyName}` : `Message ${otherName}`}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className={`form-input chat-input-field${showCounter ? " has-counter" : ""}`}
            placeholder={editing ? "Edit your message…" : replyingTo ? `Reply to ${replyName}…` : `Message ${otherName}…`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            autoComplete="off"
            aria-describedby={counterId}
          />
          <span
            id={counterId}
            className={`chat-char-counter${showCounter ? "" : " sr-only"}${remaining <= 50 ? " is-near-limit" : ""}`}
          >
            <span aria-hidden="true">
              {length}/{MAX_MESSAGE_LENGTH}
            </span>
            <span className="sr-only">
              {length} of {MAX_MESSAGE_LENGTH} characters
            </span>
          </span>
        </div>
        <button
          type="submit"
          className="chat-send-btn"
          disabled={!value.trim()}
          aria-label={editing ? "Save edit" : "Send message"}
        >
          {editing ? <CheckIcon size={18} /> : <SendIcon size={18} />}
        </button>
      </form>
    </div>
  );
}

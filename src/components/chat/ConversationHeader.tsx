"use client";

import { useId } from "react";
import type { Conversation } from "@/types/api";
import { ChevronLeftIcon, ClockIcon, HistoryIcon, RefreshCwIcon } from "@/components/Icons";

interface ConversationHeaderProps {
  conversation: Conversation;
  online: boolean;
  presenceKnown: boolean;
  toggleBusy: boolean;
  onToggleHistory: () => void;
  onBack: () => void;
  /** Show the polling note here (only when the panel-level note isn't already shown). */
  showLiveNote: boolean;
}

export default function ConversationHeader({
  conversation,
  online,
  presenceKnown,
  toggleBusy,
  onToggleHistory,
  onBack,
  showLiveNote,
}: ConversationHeaderProps) {
  const switchId = useId();
  const name = conversation.other_user.username;
  const keep = conversation.save_messages;

  return (
    <div className="chat-conversation-top">
      <div className="chat-header-bar">
        <button type="button" className="icon-btn chat-back-btn" onClick={onBack} aria-label="Back to conversations">
          <ChevronLeftIcon size={20} />
        </button>

        <div className="chat-header-user-info">
          {presenceKnown && <span className={`online-dot${online ? " active" : ""}`} aria-hidden="true" />}
          <div className="chat-header-names">
            <h3 className="chat-header-username" title={name}>
              {name}
            </h3>
            {presenceKnown && <span className="chat-header-status">{online ? "Online" : "Offline"}</span>}
          </div>
        </div>

        <div className="toggle-switch-wrapper">
          <label htmlFor={switchId} className="toggle-label">
            Keep history
          </label>
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={keep}
            aria-label="Keep history"
            className={`toggle-switch${keep ? " active" : ""}`}
            onClick={onToggleHistory}
            disabled={toggleBusy}
          />
        </div>
      </div>

      <p className={`chat-mode-banner ${keep ? "is-keep" : "is-disappearing"}`}>
        {keep ? <HistoryIcon size={14} /> : <ClockIcon size={14} />}
        <span>
          {keep
            ? "Keep history: messages are saved. Only the latest 100 messages in this chat are kept."
            : `Disappearing messages: messages are deleted after ${name} reads them.`}
        </span>
      </p>

      {showLiveNote && (
        <p className="chat-live-note" role="status">
          <RefreshCwIcon size={12} />
          <span>Live updates unavailable — refreshing periodically</span>
        </p>
      )}
    </div>
  );
}

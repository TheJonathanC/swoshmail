"use client";

import { useId, useState, type FormEvent } from "react";
import type { Conversation } from "@/types/api";
import { ClockIcon, HistoryIcon } from "@/components/Icons";
import { ChatApiError, createConversation, describeError } from "@/hooks/chat/api";

interface NewChatFormProps {
  onCreated: (conversation: Conversation) => void;
}

export default function NewChatForm({ onCreated }: NewChatFormProps) {
  const inputId = useId();
  const errorId = useId();
  const hintId = useId();
  const [username, setUsername] = useState("");
  const [keepHistory, setKeepHistory] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    setError("");
    try {
      const conv = await createConversation(name, keepHistory);
      setUsername("");
      onCreated(conv);
    } catch (err) {
      if (err instanceof ChatApiError && (err.status === 404 || err.code === "not_found")) {
        setError(`No user named '${name}'`);
      } else {
        setError(describeError(err, "Couldn't start the chat. Try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="chat-new-form" noValidate>
      <label htmlFor={inputId} className="form-label chat-new-label">
        New chat
      </label>
      <div className="chat-new-row">
        <input
          id={inputId}
          className="form-input new-chat-input"
          placeholder="Username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError("");
          }}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        />
        <button type="submit" className="btn btn-primary btn-sm new-chat-btn" disabled={busy || !username.trim()}>
          {busy ? <span className="spinner spinner-sm" aria-label="Starting chat" /> : "Start"}
        </button>
      </div>

      <fieldset className="chat-mode-choice">
        <legend className="sr-only">Message mode for the new chat</legend>
        <label
          className={`chat-mode-option${!keepHistory ? " selected" : ""}`}
          title="Messages are deleted after the other person reads them"
        >
          <input type="radio" name={`${inputId}-mode`} checked={!keepHistory} onChange={() => setKeepHistory(false)} />
          <ClockIcon size={13} />
          Disappearing
        </label>
        <label className={`chat-mode-option${keepHistory ? " selected" : ""}`} title="The latest 100 messages are saved">
          <input type="radio" name={`${inputId}-mode`} checked={keepHistory} onChange={() => setKeepHistory(true)} />
          <HistoryIcon size={13} />
          Keep history
        </label>
      </fieldset>
      <p id={hintId} className="sr-only">
        {keepHistory
          ? "The latest 100 messages are saved."
          : "Messages are deleted after the other person reads them."}
      </p>

      {error && (
        <p id={errorId} className="error-text chat-new-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

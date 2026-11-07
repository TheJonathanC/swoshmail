"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RealtimeClient } from "@supabase/realtime-js";
import type { ChatMessage, Conversation, ReplyRef } from "@/types/api";
import type { UiMessage } from "@/hooks/chat/messagesReducer";
import type { RealtimeState } from "@/hooks/chat/useRealtime";
import { useConversation } from "@/hooks/chat/useConversation";
import { useToast } from "@/components/ui/Toast";
import { ConfirmModal } from "@/components/ui/Modal";
import { ClockIcon, TrashIcon } from "@/components/Icons";
import ConversationHeader from "./ConversationHeader";
import MessageList from "./MessageList";
import ChatComposer from "./ChatComposer";

interface ConversationViewProps {
  conversation: Conversation;
  userId: string;
  username: string;
  client: RealtimeClient | null;
  realtimeState: RealtimeState;
  /** Chat tab is active (component stays mounted while hidden). */
  active: boolean;
  /** active && document visible */
  viewing: boolean;
  online: boolean;
  presenceKnown: boolean;
  onBack: () => void;
  onSaveMessagesChange: (conversationId: string, saveMessages: boolean) => void;
  onIncoming: (message: ChatMessage) => void;
}

/** One open conversation. Render with `key={conversation.id}` so all state resets per chat. */
export default function ConversationView({
  conversation,
  userId,
  username,
  client,
  realtimeState,
  active,
  viewing,
  online,
  presenceKnown,
  onBack,
  onSaveMessagesChange,
  onIncoming,
}: ConversationViewProps) {
  const toast = useToast();
  const chat = useConversation({
    client,
    realtimeState,
    conversation,
    userId,
    username,
    onSaveMessagesChange,
    onIncoming,
  });
  const { state } = chat;
  const otherName = conversation.other_user.username;

  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<ReplyRef | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UiMessage | null>(null);
  const [confirmHistoryOff, setConfirmHistoryOff] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  const editingMessage = editingId ? (state.messages.find((m) => m.id === editingId) ?? null) : null;

  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus());

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const handleSubmit = () => {
    const content = draft.trim();
    if (!content) return;
    if (editingId) {
      if (!editingMessage) {
        toast("info", "Message unavailable", "That message is no longer available to edit.");
        cancelEdit();
        return;
      }
      void chat.edit(editingMessage, content);
      cancelEdit();
      return;
    }
    chat.send(content, replyingTo);
    setDraft("");
    setReplyingTo(null);
  };

  const handleReply = (m: UiMessage) => {
    setMenuOpenKey(null);
    if (editingId) cancelEdit();
    // sender_name comes from the server; "You" is a display-only substitution.
    setReplyingTo({ id: m.id, sender_id: m.sender_id, sender_name: m.sender_name, content: m.content });
    focusInput();
  };

  const handleEdit = (m: UiMessage) => {
    if (m.status !== "sent" || m.editRollback) return;
    setMenuOpenKey(null);
    setReplyingTo(null);
    setEditingId(m.id);
    setDraft(m.content);
    focusInput();
  };

  const handleDelete = (m: UiMessage) => {
    setMenuOpenKey(null);
    setDeleteTarget(m);
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    if (editingId === target.id) cancelEdit();
    if (replyingTo?.id === target.id) setReplyingTo(null);
    void chat.remove(target);
  };

  const applyHistory = async (next: boolean) => {
    setToggleBusy(true);
    await chat.setKeepHistory(next);
    setToggleBusy(false);
  };

  const handleToggleHistory = () => {
    if (conversation.save_messages) setConfirmHistoryOff(true);
    else void applyHistory(true);
  };

  // Esc cancels reply/edit and closes the touch action menu (dialogs handle their own Esc).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || !active) return;
    if (document.querySelector("[data-swosh-modal]")) return;
    if (menuOpenKey) setMenuOpenKey(null);
    else if (editingId) cancelEdit();
    else if (replyingTo) setReplyingTo(null);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <ConversationHeader
        conversation={conversation}
        online={online}
        presenceKnown={presenceKnown}
        toggleBusy={toggleBusy}
        onToggleHistory={handleToggleHistory}
        onBack={onBack}
      />

      <MessageList
        messages={state.messages}
        notices={state.notices}
        load={state.load}
        onRetryLoad={chat.reload}
        myId={userId}
        otherName={otherName}
        viewing={viewing}
        onSeen={chat.markSeen}
        menuOpenKey={menuOpenKey}
        onToggleMenu={setMenuOpenKey}
        onReply={handleReply}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onRetry={chat.retry}
        onDiscard={chat.discard}
      />

      <ChatComposer
        inputRef={inputRef}
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        otherName={otherName}
        myId={userId}
        replyingTo={replyingTo}
        editing={editingId !== null}
        onCancelReply={() => setReplyingTo(null)}
        onCancelEdit={cancelEdit}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete message"
        icon={<TrashIcon size={18} />}
        message={
          deleteTarget?.status === "sent"
            ? `Delete this message for you and ${otherName}? This can't be undone.`
            : "Discard this unsent message?"
        }
        confirmLabel={deleteTarget?.status === "sent" ? "Delete" : "Discard"}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        open={confirmHistoryOff}
        tone="default"
        title="Turn off Keep History?"
        icon={<ClockIcon size={18} />}
        message={`New messages with ${otherName} will be deleted after they're read. This applies to new messages only — messages already saved stay in this chat.`}
        confirmLabel="Turn off"
        onConfirm={() => {
          setConfirmHistoryOff(false);
          void applyHistory(false);
        }}
        onCancel={() => setConfirmHistoryOff(false)}
      />
    </>
  );
}

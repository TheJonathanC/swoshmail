"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { MessageIcon, SendIcon, TrashIcon, EditIcon, ChevronLeftIcon, CloseIcon } from "./Icons";

// Supabase public client for Realtime (uses anon key, guarded against missing env vars)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabaseRealtime = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

interface Conversation {
  id: string;
  save_messages: boolean;
  other_user: { id: string; username: string };
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  local?: boolean; // true for session-only messages not persisted
}

interface ChatPanelProps {
  userId: string;
  username: string;
}

export default function ChatPanel({ userId, username }: ChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [activeActionMessageId, setActiveActionMessageId] = useState<string | null>(null);
  const [newChatUsername, setNewChatUsername] = useState("");
  const [newChatError, setNewChatError] = useState("");
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const presenceChannelRef = useRef<any>(null);

  // Declare fetchConversations before useEffect (satisfies React Compiler / linter)
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  }, []);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle document visibility to clear unread count
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setUnreadCount(0);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Update document title if unread count changes while hidden
  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) Swosh Chat`;
    }
  }, [unreadCount]);

  // Join global presence channel to track who's online
  useEffect(() => {
    if (!supabaseRealtime) return;

    const presenceCh = supabaseRealtime.channel("swoshchat:presence", {
      config: { presence: { key: userId } },
    });

    presenceCh
      .on("presence", { event: "sync" }, () => {
        const state = presenceCh.presenceState();
        const online = new Set(Object.keys(state));
        setOnlineUsers(online);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceCh.track({ username });
        }
      });

    presenceChannelRef.current = presenceCh;
    return () => {
      if (supabaseRealtime) {
        supabaseRealtime.removeChannel(presenceCh);
      }
    };
  }, [userId, username]);

  // Fetch conversations on mount
  useEffect(() => {
    let active = true;
    fetch("/api/chat/conversations")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setConversations(data.conversations || []);
        }
      })
      .catch((err) => console.error("Failed to load conversations:", err));

    return () => {
      active = false;
    };
  }, []);

  // Subscribe to a conversation's Realtime channel
  const subscribeToConversation = useCallback((conv: Conversation) => {
    if (!supabaseRealtime) return;

    if (channelRef.current) {
      supabaseRealtime.removeChannel(channelRef.current);
    }

    const ch = supabaseRealtime.channel(`swoshchat:conv:${conv.id}`);

    ch.on("broadcast", { event: "settings" }, ({ payload }: { payload: { save_messages?: boolean } }) => {
      if (payload.save_messages !== undefined) {
        setConversations((prev) =>
          prev.map((c) => (c.id === conv.id ? { ...c, save_messages: payload.save_messages! } : c))
        );
        setActiveConv((prev) =>
          prev && prev.id === conv.id ? { ...prev, save_messages: payload.save_messages! } : prev
        );
      }
    });

    ch.on("broadcast", { event: "message" }, ({ payload }: { payload: Message }) => {
      const incoming: Message = payload;
      
      // If document is hidden, increment unread count for the title notification
      if (document.hidden && incoming.sender_id !== userId) {
        setUnreadCount((prev) => prev + 1);
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        return [...prev, incoming];
      });

      // Auto-pong if the sender is the other user and message is "ping"
      if (
        incoming.sender_id !== userId &&
        incoming.content.trim().toLowerCase() === "ping"
      ) {
        const pongLocalId = `pong-${Date.now()}`;
        const pong: Message = {
          id: pongLocalId,
          sender_id: userId,
          content: "pong",
          created_at: new Date().toISOString(),
          local: !conv.save_messages,
        };
        setMessages((prev) => [...prev, pong]);
        ch.send({ type: "broadcast", event: "message", payload: pong });

        fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conv.id, content: "pong" }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.message?.id) {
              setMessages((prev) =>
                prev.map((m) => (m.id === pongLocalId ? { ...data.message, local: m.local } : m))
              );
              ch.send({
                type: "broadcast",
                event: "sync_id",
                payload: { tempId: pongLocalId, realId: data.message.id },
              });
            }
          })
          .catch((err) => console.error("Auto-pong persist failed:", err));
      }
    });

    // Synchronize temporary local message IDs with confirmed database UUIDs
    ch.on("broadcast", { event: "sync_id" }, ({ payload }: { payload: { tempId: string; realId: string } }) => {
      if (payload.tempId && payload.realId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === payload.tempId ? { ...m, id: payload.realId } : m))
        );
      }
    });

    ch.on("broadcast", { event: "edit_message" }, ({ payload }: { payload: { id: string; content: string } }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === payload.id ? { ...m, content: payload.content } : m))
      );
    });

    ch.on("broadcast", { event: "delete_message" }, ({ payload }: { payload: { id: string } }) => {
      setMessages((prev) => prev.filter((m) => m.id !== payload.id));
    });

    ch.subscribe();
    channelRef.current = ch;
  }, [userId]);

  // Load a conversation
  const openConversation = async (conv: Conversation) => {
    setActiveConv(conv);
    setMessages([]);
    subscribeToConversation(conv);

    try {
      const res = await fetch(`/api/chat/messages?conversationId=${conv.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  };

  // Start a new chat
  const handleStartChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatUsername.trim()) return;
    setIsStartingChat(true);
    setNewChatError("");

    try {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newChatUsername.trim(), saveMessages: false }),
      });

      const data = await res.json();
      setIsStartingChat(false);

      if (!res.ok) {
        setNewChatError(data.error || "User not found");
        return;
      }

      const conv = data.conversation;
      setConversations((prev) =>
        prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]
      );
      setNewChatUsername("");
      openConversation(conv);
    } catch {
      setIsStartingChat(false);
      setNewChatError("Unable to connect to server.");
    }
  };

  // Toggle chat settings with optimistic update and rollback
  const handleToggleSave = async () => {
    if (!activeConv) return;
    const prevSaveState = activeConv.save_messages;
    const newSaveState = !prevSaveState;
    
    setActiveConv({ ...activeConv, save_messages: newSaveState });
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConv.id ? { ...c, save_messages: newSaveState } : c))
    );

    try {
      const res = await fetch("/api/chat/conversations/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConv.id, saveMessages: newSaveState }),
      });

      if (!res.ok) {
        throw new Error("Failed to toggle setting on server");
      }

      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "settings",
          payload: { save_messages: newSaveState },
        });
      }
    } catch (err) {
      console.error("Failed to toggle settings, rolling back", err);
      setActiveConv((prev) => (prev ? { ...prev, save_messages: prevSaveState } : prev));
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConv.id ? { ...c, save_messages: prevSaveState } : c))
      );
    }
  };

  // Send or Edit a message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeConv || isSending) return;

    const content = input.trim();
    setInput("");
    setIsSending(true);

    if (editingMessageId) {
      const targetId = editingMessageId;
      setEditingMessageId(null);

      // Optimistic edit
      setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, content } : m)));
      
      const payload = { id: targetId, content };
      await channelRef.current?.send({ type: "broadcast", event: "edit_message", payload });

      if (!targetId.startsWith("local-") && !targetId.startsWith("pong-")) {
        try {
          await fetch("/api/chat/messages", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId: targetId, newContent: content }),
          });
        } catch (err) {
          console.error("Failed to persist edit:", err);
        }
      }
    } else {
      const localId = `local-${Date.now()}`;
      const msg: Message = {
        id: localId,
        sender_id: userId,
        content,
        created_at: new Date().toISOString(),
        local: !activeConv.save_messages,
      };

      setMessages((prev) => [...prev, msg]);
      await channelRef.current?.send({ type: "broadcast", event: "message", payload: msg });

      try {
        const res = await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: activeConv.id, content }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.message?.id) {
            // Replace local temporary ID with database ID
            setMessages((prev) =>
              prev.map((m) => (m.id === localId ? { ...data.message, local: m.local } : m))
            );
            // Broadcast the confirmed ID to peer
            channelRef.current?.send({
              type: "broadcast",
              event: "sync_id",
              payload: { tempId: localId, realId: data.message.id },
            });
          }
        }
      } catch (err) {
        console.error("Failed to persist message:", err);
      }
    }

    setIsSending(false);
  };

  const handleEditClick = (msg: Message) => {
    setActiveActionMessageId(null);
    setEditingMessageId(msg.id);
    setInput(msg.content);
  };

  const confirmDeleteMessage = async () => {
    if (!messageToDelete) return;
    const msgId = messageToDelete;
    setMessageToDelete(null);
    setActiveActionMessageId(null);
    
    // Optimistic delete
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    await channelRef.current?.send({ type: "broadcast", event: "delete_message", payload: { id: msgId } });

    if (!msgId.startsWith("local-") && !msgId.startsWith("pong-")) {
      try {
        await fetch(`/api/chat/messages?messageId=${msgId}`, { method: "DELETE" });
      } catch (err) {
        console.error("Failed to delete message from DB:", err);
      }
    }
  };

  const isOnline = (uid: string) => onlineUsers.has(uid);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`chat-layout ${activeConv ? "chat-active" : "chat-list-view"}`}>
      {/* Left: Conversation List */}
      <div className="chat-sidebar">
        {/* New chat form */}
        <form onSubmit={handleStartChat} className="chat-new-form">
          <label className="form-label" style={{ display: "block", marginBottom: "8px" }}>New Chat</label>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              className="form-input new-chat-input"
              placeholder="Username..."
              value={newChatUsername}
              onChange={(e) => { setNewChatUsername(e.target.value); setNewChatError(""); }}
              autoComplete="off"
            />
            <button
              type="submit"
              className="btn-primary new-chat-btn"
              disabled={isStartingChat}
              aria-label="Start chat"
            >
              {isStartingChat ? <div className="spinner" style={{ width: "14px", height: "14px" }} /> : "→"}
            </button>
          </div>
          {newChatError && <p className="error-text" style={{ marginTop: "6px", fontSize: "11px" }}>{newChatError}</p>}
        </form>

        {/* Conversations list */}
        <div className="chat-conversations-list">
          {conversations.length === 0 ? (
            <p style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
              No conversations yet.
            </p>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => openConversation(conv)}
                className={`chat-conv-item ${activeConv?.id === conv.id ? "active" : ""}`}
              >
                {/* Online indicator dot */}
                <div className={`online-dot ${isOnline(conv.other_user.id) ? "active" : ""}`} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {conv.other_user.username}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {conv.save_messages ? "● History Kept" : "○ Disappearing"}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: Chat window */}
      <div className="chat-window">
        {!activeConv ? (
          <div className="empty-state" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px" }}>
            <div style={{ color: "var(--text-muted)", opacity: 0.5 }}><MessageIcon size={48} /></div>
            <p style={{ fontSize: "15px", fontWeight: 600 }}>Select or start a conversation</p>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Type a username on the left to begin chatting.</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="chat-header-bar">
              {/* Mobile Back Button */}
              <button
                type="button"
                className="chat-back-btn"
                onClick={() => {
                  setActiveConv(null);
                  setActiveActionMessageId(null);
                }}
                title="Back to conversations"
                aria-label="Back to conversations"
              >
                <ChevronLeftIcon size={20} />
              </button>

              <div className="chat-header-user-info">
                <div className={`online-dot ${isOnline(activeConv.other_user.id) ? "active" : ""}`} style={{ width: "10px", height: "10px" }} />
                <div className="chat-header-names">
                  <span className="chat-header-username" title={activeConv.other_user.username}>
                    {activeConv.other_user.username}
                  </span>
                  <span className="chat-header-status">
                    {isOnline(activeConv.other_user.id) ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
              
              <div className="toggle-switch-wrapper">
                <span className="toggle-label toggle-label-desktop">Keep History</span>
                <span className="toggle-label toggle-label-mobile">History</span>
                <button
                  type="button"
                  className={`toggle-switch ${activeConv.save_messages ? "active" : ""}`}
                  onClick={handleToggleSave}
                  title={activeConv.save_messages ? "Messages are saved" : "Disappearing mode enabled"}
                  aria-label="Toggle Disappearing Messages"
                />
              </div>
            </div>

            {/* Messages */}
            <div className="chat-messages-container" onClick={() => setActiveActionMessageId(null)}>
              {messages.length === 0 && (
                <div style={{ textAlign: "center", marginTop: "auto", marginBottom: "auto", padding: "20px" }}>
                  <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "8px" }}>
                    No messages yet. Say hello — or try sending <code style={{ background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: "4px" }}>ping</code>!
                  </p>
                  {!activeConv.save_messages && (
                    <p style={{ color: "var(--text-muted)", fontSize: "11px", opacity: 0.7 }}>
                      ℹ️ Disappearing Mode is ON. Messages will vanish after they are read.
                    </p>
                  )}
                </div>
              )}
              {messages.map((msg) => {
                const isMine = msg.sender_id === userId;
                const isPing = msg.content.toLowerCase() === "ping";
                const isPong = msg.content.toLowerCase() === "pong";
                const isActionActive = activeActionMessageId === msg.id;

                return (
                  <div key={msg.id} className={`chat-message-row ${isMine ? "mine" : "other"}`}>
                    <div
                      className={`chat-bubble ${isMine ? "mine" : "other"} ${isMine ? "chat-bubble-interactive" : ""}`}
                      onClick={(e) => {
                        if (isMine) {
                          e.stopPropagation();
                          setActiveActionMessageId((prev) => (prev === msg.id ? null : msg.id));
                        }
                      }}
                      title={isMine ? "Tap to edit or delete" : undefined}
                    >
                      {isPing ? (
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ color: "var(--primary)", fontSize: "10px" }}>●</span> ping</span>
                      ) : isPong ? (
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ color: "var(--success)", fontSize: "10px" }}>●</span> pong</span>
                      ) : (
                        msg.content
                      )}
                      <div style={{ fontSize: "10px", opacity: 0.7, marginTop: "4px", textAlign: "right" }}>
                        {formatTime(msg.created_at)}
                      </div>
                    </div>
                    {isMine && (
                      <div className={`message-actions ${isActionActive ? "show-actions" : ""}`}>
                        <button
                          type="button"
                          className="action-icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditClick(msg);
                          }}
                          title="Edit Message"
                          aria-label="Edit Message"
                        >
                          <EditIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMessageToDelete(msg.id);
                            setActiveActionMessageId(null);
                          }}
                          title="Delete Message"
                          aria-label="Delete Message"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Editing banner */}
            {editingMessageId && (
              <div className="chat-editing-banner">
                <div className="editing-banner-content">
                  <EditIcon size={14} />
                  <span>Editing message</span>
                </div>
                <button
                  type="button"
                  className="editing-cancel-btn"
                  onClick={() => {
                    setEditingMessageId(null);
                    setInput("");
                  }}
                  aria-label="Cancel editing"
                >
                  <CloseIcon size={14} /> Cancel
                </button>
              </div>
            )}

            {/* Message input */}
            <form onSubmit={handleSend} className="chat-input-bar">
              <div className="chat-input-wrapper">
                <input
                  className="form-input chat-input-field"
                  placeholder={`Message ${activeConv.other_user.username}...`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={500}
                  autoComplete="off"
                />
                {input.length >= 350 && (
                  <div className="chat-char-counter" style={{ color: input.length >= 480 ? "var(--danger)" : "var(--text-muted)" }}>
                    {input.length}/500
                  </div>
                )}
              </div>
              <button
                type="submit"
                className="btn-primary chat-send-btn"
                disabled={!input.trim() || isSending}
                aria-label="Send message"
              >
                {isSending ? <div className="spinner" style={{ width: "16px", height: "16px" }} /> : <SendIcon size={18} />}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Custom Delete Message Modal */}
      {messageToDelete && (
        <div className="modal-overlay" onClick={() => setMessageToDelete(null)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)" }}>
                <TrashIcon size={18} /> Delete Message
              </h3>
            </header>
            <div className="modal-body" style={{ padding: "20px" }}>
              <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--text-muted)" }}>
                Are you sure you want to delete this message? This action cannot be undone.
              </p>
            </div>
            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px" }}>
              <button
                className="btn-secondary"
                style={{ padding: "10px 16px" }}
                onClick={() => setMessageToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ background: "var(--danger)", padding: "10px 16px", width: "auto" }}
                onClick={confirmDeleteMessage}
              >
                Delete
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

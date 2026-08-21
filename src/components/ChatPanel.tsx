"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { MessageIcon, SendIcon, TrashIcon, EditIcon } from "./Icons";

// Supabase public client for Realtime (uses anon key, not service role)
const supabaseRealtime = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
  const [newChatUsername, setNewChatUsername] = useState("");
  const [saveMessages, setSaveMessages] = useState(false);
  const [newChatError, setNewChatError] = useState("");
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const presenceChannelRef = useRef<any>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle document visibility to clear unread count
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setUnreadCount(0);
        document.title = "Swosh Chat";
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
    return () => { supabaseRealtime.removeChannel(presenceCh); };
  }, [userId, username]);

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    const res = await fetch("/api/chat/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations || []);
    }
  };

  // Subscribe to a conversation's Realtime channel
  const subscribeToConversation = useCallback((conv: Conversation) => {
    if (channelRef.current) {
      supabaseRealtime.removeChannel(channelRef.current);
    }

    const ch = supabaseRealtime.channel(`swoshchat:conv:${conv.id}`);

    ch.on("broadcast", { event: "settings" }, ({ payload }: any) => {
      if (payload.save_messages !== undefined) {
        setConversations((prev) =>
          prev.map((c) => (c.id === conv.id ? { ...c, save_messages: payload.save_messages } : c))
        );
        setActiveConv((prev) =>
          prev && prev.id === conv.id ? { ...prev, save_messages: payload.save_messages } : prev
        );
      }
    });

    ch.on("broadcast", { event: "message" }, ({ payload }: any) => {
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
        const pong: Message = {
          id: `pong-${Date.now()}`,
          sender_id: userId,
          content: "pong",
          created_at: new Date().toISOString(),
          local: !conv.save_messages,
        };
        setMessages((prev) => [...prev, pong]);
        ch.send({ type: "broadcast", event: "message", payload: pong });
        // Always persist to DB (API handles Snapchat deletion logic)
        fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conv.id, content: "pong" }),
        });
      }
    });

    ch.on("broadcast", { event: "edit_message" }, ({ payload }: any) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === payload.id ? { ...m, content: payload.content } : m))
      );
    });

    ch.on("broadcast", { event: "delete_message" }, ({ payload }: any) => {
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

    // Always fetch messages (API handles Snapchat deletion logic)
    const res = await fetch(`/api/chat/messages?conversationId=${conv.id}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
  };

  // Start a new chat
  const handleStartChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatUsername.trim()) return;
    setIsStartingChat(true);
    setNewChatError("");

    const res = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newChatUsername.trim(), saveMessages: false }), // Default to false (Disappearing Mode)
    });

    const data = await res.json();
    setIsStartingChat(false);

    if (!res.ok) {
      setNewChatError(data.error || "User not found");
      return;
    }

    const conv = data.conversation;
    // Add to list if not already there
    setConversations((prev) =>
      prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]
    );
    setNewChatUsername("");
    openConversation(conv);
  };

  // Toggle chat settings
  const handleToggleSave = async () => {
    if (!activeConv) return;
    const newSaveState = !activeConv.save_messages;
    
    // Optimistic UI update
    setActiveConv({ ...activeConv, save_messages: newSaveState });
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConv.id ? { ...c, save_messages: newSaveState } : c))
    );

    try {
      await fetch("/api/chat/conversations/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConv.id, saveMessages: newSaveState }),
      });

      // Broadcast to other user so their UI updates immediately
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "settings",
          payload: { save_messages: newSaveState },
        });
      }
    } catch (err) {
      console.error("Failed to toggle settings", err);
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
      // Optimistic edit
      setMessages((prev) => prev.map((m) => (m.id === editingMessageId ? { ...m, content } : m)));
      
      const payload = { id: editingMessageId, content };
      await channelRef.current?.send({ type: "broadcast", event: "edit_message", payload });

      if (!editingMessageId.startsWith("local-") && !editingMessageId.startsWith("pong-")) {
        await fetch("/api/chat/messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: editingMessageId, newContent: content }),
        });
      }
      setEditingMessageId(null);
    } else {
      const msg: Message = {
        id: `local-${Date.now()}`,
        sender_id: userId,
        content,
        created_at: new Date().toISOString(),
        local: !activeConv.save_messages,
      };

      setMessages((prev) => [...prev, msg]);

      await channelRef.current?.send({ type: "broadcast", event: "message", payload: msg });

      await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConv.id, content }),
      });
    }

    setIsSending(false);
  };

  const handleEditClick = (msg: Message) => {
    setEditingMessageId(msg.id);
    setInput(msg.content);
  };

  const confirmDeleteMessage = async () => {
    if (!messageToDelete) return;
    const msgId = messageToDelete;
    setMessageToDelete(null);
    
    // Optimistic delete
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    await channelRef.current?.send({ type: "broadcast", event: "delete_message", payload: { id: msgId } });

    if (!msgId.startsWith("local-") && !msgId.startsWith("pong-")) {
      await fetch(`/api/chat/messages?messageId=${msgId}`, { method: "DELETE" });
    }
  };

  const isOnline = (uid: string) => onlineUsers.has(uid);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="chat-layout">
      {/* Left: Conversation List */}
      <div className="chat-sidebar" style={{ paddingRight: "16px" }}>
        {/* New chat form */}
        <form onSubmit={handleStartChat} style={{ padding: "0 0 16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: "16px" }}>
          <label className="form-label" style={{ display: "block", marginBottom: "8px" }}>New Chat</label>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              className="form-input"
              style={{ flex: 1, padding: "8px 10px", fontSize: "13px" }}
              placeholder="Username..."
              value={newChatUsername}
              onChange={(e) => { setNewChatUsername(e.target.value); setNewChatError(""); }}
            />
            <button
              type="submit"
              className="btn-primary"
              style={{ width: "auto", padding: "8px 10px", flexShrink: 0 }}
              disabled={isStartingChat}
            >
              {isStartingChat ? <div className="spinner" style={{ width: "12px", height: "12px" }} /> : "→"}
            </button>
          </div>
          {newChatError && <p className="error-text" style={{ marginTop: "6px", fontSize: "11px" }}>{newChatError}</p>}
        </form>

        {/* Conversations list */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
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
                <div style={{ minWidth: 0 }}>
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
              <div className={`online-dot ${isOnline(activeConv.other_user.id) ? "active" : ""}`} style={{ width: "10px", height: "10px" }} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "16px", fontWeight: 700 }}>{activeConv.other_user.username}</span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                  {isOnline(activeConv.other_user.id) ? "Online" : "Offline"}
                </span>
              </div>
              
              <div className="toggle-switch-wrapper">
                <span className="toggle-label">Keep Chat History</span>
                <button
                  type="button"
                  className={`toggle-switch ${activeConv.save_messages ? "active" : ""}`}
                  onClick={handleToggleSave}
                  title="Toggle Disappearing Messages"
                />
              </div>
            </div>

            {/* Messages */}
            <div className="chat-messages-container">
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
                return (
                  <div key={msg.id} className={`chat-message-row ${isMine ? "mine" : "other"}`}>
                    <div className={`chat-bubble ${isMine ? "mine" : "other"}`}>
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
                      <div className="message-actions">
                        <button className="action-icon-btn" onClick={() => handleEditClick(msg)} title="Edit Message">
                          <EditIcon size={14} />
                        </button>
                        <button className="action-icon-btn danger" onClick={() => setMessageToDelete(msg.id)} title="Delete Message">
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <form onSubmit={handleSend} className="chat-input-bar" style={{ padding: "16px 0 0 0", marginTop: "auto", display: "flex", gap: "10px", alignItems: "center" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  className="form-input"
                  style={{ width: "100%", padding: "14px 18px", paddingRight: "60px", borderRadius: "100px" }}
                  placeholder={editingMessageId ? "Editing message..." : `Message ${activeConv.other_user.username}... (try "ping")`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={500}
                  autoComplete="off"
                />
                <div style={{ position: "absolute", right: "16px", top: "50%", transform: "translateY(-50%)", fontSize: "10px", color: input.length >= 450 ? "var(--danger)" : "var(--text-muted)", pointerEvents: "none" }}>
                  {input.length}/500
                </div>
              </div>
              {editingMessageId && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ borderRadius: "100px", padding: "14px 18px", background: "rgba(255,255,255,0.05)" }}
                  onClick={() => {
                    setEditingMessageId(null);
                    setInput("");
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="btn-primary"
                style={{ width: "48px", height: "48px", padding: "0", borderRadius: "50%", flexShrink: 0 }}
                disabled={!input.trim() || isSending}
              >
                {isSending ? <div className="spinner" style={{ width: "14px", height: "14px" }} /> : <div style={{ display: "flex", marginLeft: "-2px" }}><SendIcon size={18} /></div>}
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

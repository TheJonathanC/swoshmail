"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

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
  const [newChatUsername, setNewChatUsername] = useState("");
  const [saveMessages, setSaveMessages] = useState(false);
  const [newChatError, setNewChatError] = useState("");
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const presenceChannelRef = useRef<any>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

    ch.on("broadcast", { event: "message" }, ({ payload }: any) => {
      const incoming: Message = payload;
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
        if (conv.save_messages) {
          fetch("/api/chat/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: conv.id, content: "pong" }),
          });
        }
      }
    }).subscribe();

    channelRef.current = ch;
  }, [userId]);

  // Load a conversation
  const openConversation = async (conv: Conversation) => {
    setActiveConv(conv);
    setMessages([]);
    subscribeToConversation(conv);

    // Load persisted messages if enabled
    if (conv.save_messages) {
      const res = await fetch(`/api/chat/messages?conversationId=${conv.id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
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
      body: JSON.stringify({ username: newChatUsername.trim(), saveMessages }),
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

  // Send a message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeConv || isSending) return;

    const content = input.trim();
    setInput("");
    setIsSending(true);

    const msg: Message = {
      id: `local-${Date.now()}`,
      sender_id: userId,
      content,
      created_at: new Date().toISOString(),
      local: !activeConv.save_messages,
    };

    setMessages((prev) => [...prev, msg]);

    // Broadcast via Realtime
    await channelRef.current?.send({
      type: "broadcast",
      event: "message",
      payload: msg,
    });

    // Persist to DB if save_messages is on
    if (activeConv.save_messages) {
      await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConv.id, content }),
      });
    }

    setIsSending(false);
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
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "12px" }}>
            <input
              type="checkbox"
              id="save_msg_check"
              checked={saveMessages}
              onChange={(e) => setSaveMessages(e.target.checked)}
              style={{ cursor: "pointer", width: "14px", height: "14px" }}
            />
            <label htmlFor="save_msg_check" style={{ fontSize: "12px", color: "var(--text-muted)", cursor: "pointer" }}>
              Save messages
            </label>
          </div>
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
                  <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    {conv.save_messages ? "💾 Saved" : "👻 Session only"}
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
            <div style={{ fontSize: "40px" }}>💬</div>
            <p style={{ fontSize: "15px", fontWeight: 600 }}>Select or start a conversation</p>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Type a username on the left to begin chatting.</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="chat-header-bar">
              <div className={`online-dot ${isOnline(activeConv.other_user.id) ? "active" : ""}`} style={{ width: "10px", height: "10px" }} />
              <span style={{ fontSize: "16px", fontWeight: 700 }}>{activeConv.other_user.username}</span>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>
                {isOnline(activeConv.other_user.id) ? "● Online" : "○ Offline"}
              </span>
              {!activeConv.save_messages && (
                <span style={{ marginLeft: "auto", fontSize: "11px", background: "rgba(255,255,255,0.05)", padding: "3px 8px", borderRadius: "20px", color: "var(--text-muted)" }}>
                  👻 Session only
                </span>
              )}
            </div>

            {/* Messages */}
            <div className="chat-messages-container">
              {messages.length === 0 && (
                <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "13px", marginTop: "20px" }}>
                  No messages yet. Say hello — or try sending <code style={{ background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: "4px" }}>ping</code>!
                </p>
              )}
              {messages.map((msg) => {
                const isMine = msg.sender_id === userId;
                const isPing = msg.content.toLowerCase() === "ping";
                const isPong = msg.content.toLowerCase() === "pong";
                return (
                  <div key={msg.id} className={`chat-message-row ${isMine ? "mine" : "other"}`}>
                    <div className={`chat-bubble ${isMine ? "mine" : "other"}`}>
                      {isPing ? "🏓 ping" : isPong ? "🏓 pong" : msg.content}
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", paddingBottom: "2px" }}>
                      {formatTime(msg.created_at)}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <form onSubmit={handleSend} className="chat-input-bar">
              <input
                className="form-input"
                style={{ flex: 1 }}
                placeholder={`Message ${activeConv.other_user.username}... (try "ping")`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoComplete="off"
              />
              <button
                type="submit"
                className="btn-primary"
                style={{ width: "auto", padding: "0 20px", flexShrink: 0 }}
                disabled={!input.trim() || isSending}
              >
                {isSending ? <div className="spinner" style={{ width: "14px", height: "14px" }} /> : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// GET: Fetch persisted messages for a conversation (only if save_messages=true)
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    // Rate Limit: 60 GET requests per minute per user
    const rl = checkRateLimit(`chat_get_${userId}`, 60, 60000);
    if (!rl.success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });

    // Verify user is a participant
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (convError || !conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    // Fetch the most recent 100 messages (ordered descending, then reversed for chronological view)
    const { data: rawMessages, error } = await supabase
      .from("messages")
      .select("id, sender_id, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const messages = (rawMessages || []).reverse();

    // Snapchat mechanics: if save_messages is false, delete the messages the user just read
    if (!conv.save_messages && messages && messages.length > 0) {
      const readMessageIds = messages
        .filter((m: { sender_id: string; id: string }) => m.sender_id !== userId)
        .map((m: { id: string }) => m.id);

      if (readMessageIds.length > 0) {
        // Delete messages sent by the other user, as the current user has now "seen" them
        await supabase
          .from("messages")
          .delete()
          .in("id", readMessageIds);
      }
    }

    return NextResponse.json(
      { messages: messages || [] },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Persist a message to the DB
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    // Rate Limit: 30 messages per minute per user
    const rl = checkRateLimit(`chat_send_${userId}`, 30, 60000);
    if (!rl.success) return NextResponse.json({ error: "Rate limit exceeded. You are sending messages too fast." }, { status: 429 });

    const { conversationId, content } = await request.json();
    if (!conversationId || !content?.trim())
      return NextResponse.json({ error: "conversationId and content are required" }, { status: 400 });
    
    if (content.length > 500) {
      return NextResponse.json({ error: "Message exceeds 500 characters" }, { status: 400 });
    }

    // Verify participant
    const { data: conv } = await supabase
      .from("conversations")
      .select("save_messages, user1_id, user2_id")
      .eq("id", conversationId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const { data: msg, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: userId, content: content.trim() })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-prune oldest messages: Keep conversation capped at MAX_STORED_MESSAGES (100)
    // This prevents database bloat and ensures space is always available for newer messages
    try {
      const MAX_STORED_MESSAGES = 100;
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId);

      if (count && count > MAX_STORED_MESSAGES) {
        const excess = count - MAX_STORED_MESSAGES;
        const { data: oldest } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(excess);

        if (oldest && oldest.length > 0) {
          const pruneIds = oldest.map((m: { id: string }) => m.id);
          await supabase.from("messages").delete().in("id", pruneIds);
        }
      }
    } catch (pruneErr) {
      console.error("Message auto-pruning error:", pruneErr);
    }

    return NextResponse.json({ success: true, message: msg });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to persist message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH: Edit a message
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    // Rate Limit: 20 edits per minute per user
    const rl = checkRateLimit(`chat_edit_${userId}`, 20, 60000);
    if (!rl.success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

    const { messageId, newContent } = await request.json();
    if (!messageId || !newContent?.trim()) {
      return NextResponse.json({ error: "messageId and newContent are required" }, { status: 400 });
    }

    if (newContent.length > 500) {
      return NextResponse.json({ error: "Message exceeds 500 characters" }, { status: 400 });
    }

    // Update message, ensuring the user is the sender
    const { data: msg, error } = await supabase
      .from("messages")
      .update({ content: newContent.trim() })
      .eq("id", messageId)
      .eq("sender_id", userId) // Security: only sender can edit
      .select()
      .single();

    if (error || !msg) return NextResponse.json({ error: "Failed to edit message. It may not exist or you don't own it." }, { status: 403 });

    return NextResponse.json({ success: true, message: msg });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to edit message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Delete a message
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("messageId");
    if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("sender_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to delete message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// GET: Fetch persisted messages for a conversation (only if save_messages=true)
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

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
    if (!conv.save_messages) return NextResponse.json({ messages: [] });

    const { data: messages, error } = await supabase
      .from("messages")
      .select("id, sender_id, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ messages });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: Persist a message to the DB (only when save_messages=true)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    const { conversationId, content } = await request.json();
    if (!conversationId || !content?.trim())
      return NextResponse.json({ error: "conversationId and content are required" }, { status: 400 });

    // Verify participant
    const { data: conv } = await supabase
      .from("conversations")
      .select("save_messages, user1_id, user2_id")
      .eq("id", conversationId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    if (!conv.save_messages) return NextResponse.json({ success: true }); // not saving, that's fine

    const { data: msg, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: userId, content: content.trim() })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, message: msg });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

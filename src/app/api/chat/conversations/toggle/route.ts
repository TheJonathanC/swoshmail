import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    const { conversationId, saveMessages } = await request.json();
    if (!conversationId || typeof saveMessages !== "boolean") {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    // Verify user is a participant
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Update the conversation
    const { error: updateError } = await supabase
      .from("conversations")
      .update({ save_messages: saveMessages })
      .eq("id", conversationId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, save_messages: saveMessages });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

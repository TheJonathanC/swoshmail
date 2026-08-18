import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// GET: Fetch all conversations for the logged-in user (with other user's username)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    const { data, error } = await supabase
      .from("conversations")
      .select(`
        id, save_messages, created_at,
        user1:users!conversations_user1_id_fkey(id, username),
        user2:users!conversations_user2_id_fkey(id, username)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Normalize: expose the "other" user in each conversation
    const conversations = (data || []).map((c: any) => ({
      id: c.id,
      save_messages: c.save_messages,
      created_at: c.created_at,
      other_user: c.user1.id === userId ? c.user2 : c.user1,
    }));

    return NextResponse.json({ conversations });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: Start a new conversation by providing a username
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any).id;

    const { username, saveMessages } = await request.json();
    if (!username) return NextResponse.json({ error: "Username is required" }, { status: 400 });
    if (username === (session.user as any).username)
      return NextResponse.json({ error: "You cannot chat with yourself" }, { status: 400 });

    // Resolve username to user ID
    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id, username")
      .eq("username", username)
      .single();

    if (userError || !targetUser)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Use consistent ordering so (A,B) and (B,A) are the same row
    const [u1, u2] = [userId, targetUser.id].sort();

    const { data: existing } = await supabase
      .from("conversations")
      .select("*")
      .eq("user1_id", u1)
      .eq("user2_id", u2)
      .single();

    if (existing) return NextResponse.json({ conversation: { ...existing, other_user: targetUser } });

    const { data: newConv, error: insertError } = await supabase
      .from("conversations")
      .insert({ user1_id: u1, user2_id: u2, save_messages: saveMessages ?? false })
      .select()
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ conversation: { ...newConv, other_user: targetUser } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

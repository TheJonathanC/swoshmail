import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { generateShareToken, verifyShareToken } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";

// POST: Create a shareable link for a file (owner only)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkRateLimit(`drive_share_create_${userId}`, 30, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Too many share requests. Please wait." }, { status: 429 });
    }

    const body = await request.json();
    const { fileId } = body;

    if (!fileId || typeof fileId !== "string") {
      return NextResponse.json({ error: "Missing file ID" }, { status: 400 });
    }

    // Verify user owns the file
    const { data: file, error } = await supabase
      .from("files")
      .select("id, name, size, key")
      .eq("id", fileId)
      .eq("owner_id", userId)
      .single();

    if (error || !file) {
      return NextResponse.json({ error: "File not found or access denied" }, { status: 404 });
    }

    const token = generateShareToken(file.id, userId);

    return NextResponse.json({
      success: true,
      token,
      file: {
        id: file.id,
        name: file.name,
        size: file.size,
      },
    });
  } catch (error: unknown) {
    console.error("POST drive share error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate share link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: Inspect and resolve a shared file by token (only for authenticated Swosh users)
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Authentication required. You must be signed in to Swosh Workspace to access shared files.", requiresAuth: true },
        { status: 401 }
      );
    }
    const userId = (session.user as { id?: string }).id;

    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Missing share token" }, { status: 400 });
    }

    const verified = verifyShareToken(token);
    if (!verified) {
      return NextResponse.json(
        { error: "Invalid or tampered share link. Please ask the sender for a new link." },
        { status: 400 }
      );
    }

    // Rate Limit token inspection
    const rl = checkRateLimit(`drive_share_view_${userId}`, 60, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Please wait a moment." }, { status: 429 });
    }

    // Fetch file and owner's username
    const { data: file, error } = await supabase
      .from("files")
      .select(`
        id, name, size, key, url, uploaded_at, owner_id,
        owner:users!files_owner_id_fkey(username)
      `)
      .eq("id", verified.fileId)
      .eq("owner_id", verified.ownerId)
      .single();

    if (error || !file) {
      return NextResponse.json(
        { error: "This file is no longer available or was deleted by the owner." },
        { status: 404 }
      );
    }

    const ownerData = file.owner as { username?: string } | null;
    const sharedBy = ownerData?.username ? `@${ownerData.username}` : "A Swosh user";

    return NextResponse.json({
      success: true,
      file: {
        id: file.id,
        name: file.name,
        size: file.size,
        uploaded_at: file.uploaded_at,
      },
      sharedBy,
      isOwner: userId === file.owner_id,
    });
  } catch (error: unknown) {
    console.error("GET drive share error:", error);
    const message = error instanceof Error ? error.message : "Failed to load shared file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

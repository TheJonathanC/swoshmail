import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getFileFromR2 } from "@/lib/r2";
import { verifyShareToken } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";

// GET: Securely stream and download a shared file for authenticated Swosh users
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Authentication required to download shared files.", requiresAuth: true },
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
      return NextResponse.json({ error: "Invalid share link" }, { status: 400 });
    }

    const rl = checkRateLimit(`drive_share_dl_${userId}`, 30, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Please wait." }, { status: 429 });
    }

    // Verify file exists and belongs to the owner
    const { data: file, error } = await supabase
      .from("files")
      .select("id, name, size, key")
      .eq("id", verified.fileId)
      .eq("owner_id", verified.ownerId)
      .single();

    if (error || !file) {
      return NextResponse.json({ error: "File not found or access revoked" }, { status: 404 });
    }

    const r2Response = await getFileFromR2(file.key);

    const headers = new Headers();
    headers.set("Content-Type", r2Response.ContentType || "application/octet-stream");
    headers.set("Content-Length", String(file.size));
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );

    return new Response(r2Response.Body as any, { headers });
  } catch (error: unknown) {
    console.error("Download shared file error:", error);
    const message = error instanceof Error ? error.message : "Download failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

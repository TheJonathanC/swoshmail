import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getFileFromR2 } from "@/lib/r2";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Missing file key" }, { status: 400 });
    }

    // 1. Verify ownership of the file key
    const { data: file, error } = await supabase
      .from("files")
      .select("*")
      .eq("key", key)
      .eq("owner_id", userId)
      .single();

    if (error || !file) {
      return NextResponse.json({ error: "File not found or access denied" }, { status: 404 });
    }

    // 2. Fetch the file from Cloudflare R2
    const r2Response = await getFileFromR2(key);

    // Limit text previews to 256 KB to protect memory/bandwidth
    if (file.size > 256 * 1024) {
      return NextResponse.json({
        content: `[File size: ${(file.size / 1024).toFixed(1)} KB]\n\nPreview is truncated. This file is too large to preview directly in the browser. Please download it using the link.`,
        isTruncated: true,
      });
    }

    const textContent = await r2Response.Body?.transformToString("utf-8");

    return NextResponse.json({
      content: textContent || "",
      isTruncated: false,
    });
  } catch (error: any) {
    console.error("Preview retrieval error:", error);
    return NextResponse.json({ error: "Failed to load file preview" }, { status: 500 });
  }
}

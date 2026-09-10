import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getFileFromR2 } from "@/lib/r2";
import { checkRateLimit } from "@/lib/rate-limit";

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt", "log", "md", "json", "css", "js", "ts", "jsx", "tsx",
  "html", "xml", "csv", "sql", "yaml", "yml", "env", "conf", "ini", "sh"
]);

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate Limit: 60 previews per minute per user
    const rl = checkRateLimit(`drive_preview_${userId}`, 60, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Too many preview requests." }, { status: 429 });
    }

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

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!TEXT_PREVIEW_EXTENSIONS.has(ext)) {
      return NextResponse.json({
        content: `Preview not available for .${ext} files. Please download the file to view it.`,
        isTruncated: false,
      });
    }

    // Limit text previews to 256 KB to protect memory/bandwidth
    // Check size BEFORE fetching from Cloudflare R2
    if (file.size > 256 * 1024) {
      return NextResponse.json({
        content: `[File size: ${(file.size / 1024).toFixed(1)} KB]\n\nPreview is truncated. This file is too large to preview directly in the browser. Please download it using the link.`,
        isTruncated: true,
      });
    }

    // 2. Fetch the file from Cloudflare R2 only when eligible
    const r2Response = await getFileFromR2(key);
    const textContent = await r2Response.Body?.transformToString("utf-8");

    return NextResponse.json({
      content: textContent || "",
      isTruncated: false,
    });
  } catch (error: unknown) {
    console.error("Preview retrieval error:", error);
    const message = error instanceof Error ? error.message : "Failed to load file preview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

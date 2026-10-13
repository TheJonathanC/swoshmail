import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getFileFromR2 } from "@/lib/r2";
import { verifyShareToken } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt", "log", "md", "json", "css", "js", "ts", "jsx", "tsx",
  "html", "xml", "csv", "sql", "yaml", "yml", "env", "conf", "ini", "sh"
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

// GET: Securely preview a shared file for authenticated Swosh users
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Authentication required to preview shared files.", requiresAuth: true },
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

    const rl = checkRateLimit(`drive_share_pv_${userId}`, 60, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const { data: file, error } = await supabase
      .from("files")
      .select("id, name, size, key")
      .eq("id", verified.fileId)
      .eq("owner_id", verified.ownerId)
      .single();

    if (error || !file) {
      return NextResponse.json({ error: "File not found or access revoked" }, { status: 404 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    // Image preview: stream inline image
    if (IMAGE_EXTENSIONS.has(ext)) {
      const r2Response = await getFileFromR2(file.key);
      const headers = new Headers();
      headers.set("Content-Type", r2Response.ContentType || `image/${ext === "svg" ? "svg+xml" : ext}`);
      headers.set("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);
      return new Response(r2Response.Body as any, { headers });
    }

    // Text preview: return JSON with content
    if (TEXT_PREVIEW_EXTENSIONS.has(ext)) {
      if (file.size > 256 * 1024) {
        return NextResponse.json({
          content: `[File size: ${(file.size / 1024).toFixed(1)} KB]\n\nPreview is truncated because this file is larger than 256 KB. Please download or save it to view.`,
          isTruncated: true,
        });
      }

      const r2Response = await getFileFromR2(file.key);
      const textContent = await r2Response.Body?.transformToString("utf-8");
      return NextResponse.json({
        content: textContent || "",
        isTruncated: false,
      });
    }

    return NextResponse.json({
      content: `Preview not available for .${ext} files. Please download or save the file to view it.`,
      isTruncated: false,
    });
  } catch (error: unknown) {
    console.error("Shared preview error:", error);
    const message = error instanceof Error ? error.message : "Failed to load preview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

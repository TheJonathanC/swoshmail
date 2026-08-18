import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getFileFromR2 } from "@/lib/r2";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    const userId = (session.user as any).id;

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return new Response("Missing file key", { status: 400 });
    }

    // Verify ownership of the file key
    const { data: file, error } = await supabase
      .from("files")
      .select("*")
      .eq("key", key)
      .eq("owner_id", userId)
      .single();

    if (error || !file) {
      return new Response("File not found or access denied", { status: 404 });
    }

    // Fetch the file from Cloudflare R2
    const r2Response = await getFileFromR2(key);
    
    // Pipe the S3 stream directly to the Next.js Response
    const responseStream = r2Response.Body as any;

    return new Response(responseStream, {
      headers: {
        "Content-Type": r2Response.ContentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
        "Content-Length": file.size.toString(),
      },
    });
  } catch (error: any) {
    console.error("Download error:", error);
    return new Response("Failed to download file.", { status: 500 });
  }
}

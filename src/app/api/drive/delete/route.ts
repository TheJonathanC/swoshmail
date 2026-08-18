import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { deleteFromR2 } from "@/lib/r2";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await request.json();
    const { fileId } = body;

    if (!fileId) {
      return NextResponse.json({ error: "No file ID provided" }, { status: 400 });
    }

    // 1. Fetch file to check ownership
    const { data: file, error: fetchError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .single();

    if (fetchError || !file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (file.owner_id !== userId) {
      return NextResponse.json({ error: "Unauthorized to delete this file" }, { status: 403 });
    }

    // 2. Delete file from Cloudflare R2
    try {
      await deleteFromR2(file.key);
    } catch (r2Error) {
      console.error("R2 deletion failed, proceeding to clear DB anyway:", r2Error);
    }

    // 3. Delete from Database
    const { error: deleteError } = await supabase
      .from("files")
      .delete()
      .eq("id", fileId);

    if (deleteError) {
      return NextResponse.json({ error: "Failed to delete file record from database" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "File successfully deleted" });
  } catch (error: any) {
    console.error("Delete file error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete file" }, { status: 500 });
  }
}

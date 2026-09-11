import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { deleteFromR2 } from "@/lib/r2";
import { checkRateLimit } from "@/lib/rate-limit";

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

    // Rate Limit: 60 delete operations per minute
    const rl = checkRateLimit(`drive_delete_${userId}`, 60, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Too many delete requests." }, { status: 429 });
    }

    const body = await request.json();
    const { fileId, fileIds } = body;

    // Normalize IDs into an array
    const targetIds: string[] = [];
    if (Array.isArray(fileIds)) {
      for (const id of fileIds) {
        if (typeof id === "string" && id.trim()) {
          targetIds.push(id.trim());
        }
      }
    } else if (typeof fileId === "string" && fileId.trim()) {
      targetIds.push(fileId.trim());
    }

    if (targetIds.length === 0) {
      return NextResponse.json({ error: "No file ID(s) provided" }, { status: 400 });
    }

    // 1. Fetch files belonging to user
    const { data: files, error: fetchError } = await supabase
      .from("files")
      .select("id, key, name")
      .in("id", targetIds)
      .eq("owner_id", userId);

    if (fetchError || !files || files.length === 0) {
      return NextResponse.json({ error: "Files not found or access denied" }, { status: 404 });
    }

    // 2. Delete each file from R2
    const deletedIds: string[] = [];
    for (const file of files) {
      try {
        await deleteFromR2(file.key);
      } catch (r2Error) {
        console.error(`R2 deletion failed for key ${file.key}:`, r2Error);
      }
      deletedIds.push(file.id);
    }

    // 3. Delete from Database
    const { error: deleteError } = await supabase
      .from("files")
      .delete()
      .in("id", deletedIds)
      .eq("owner_id", userId);

    if (deleteError) {
      return NextResponse.json({ error: "Failed to delete file records from database" }, { status: 500 });
    }

    const message = deletedIds.length === 1
      ? "File successfully deleted"
      : `${deletedIds.length} files successfully deleted`;

    return NextResponse.json({
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      message,
    });
  } catch (error: unknown) {
    console.error("Delete file error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete file(s)";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



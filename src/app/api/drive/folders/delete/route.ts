import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { deleteFromR2 } from "@/lib/r2";

// Helper function to recursively collect all files in a folder and its subfolders
async function getRecursiveFiles(folderId: string, userId: string): Promise<any[]> {
  let filesList: any[] = [];

  // 1. Get direct files
  const { data: files }: { data: any[] | null } = await supabase
    .from("files")
    .select("*")
    .eq("owner_id", userId)
    .eq("folder_id", folderId);

  if (files) {
    filesList = [...filesList, ...files];
  }

  // 2. Get subfolders
  const { data: subfolders }: { data: any[] | null } = await supabase
    .from("folders")
    .select("id")
    .eq("owner_id", userId)
    .eq("parent_id", folderId);

  if (subfolders) {
    for (const sub of subfolders) {
      const subFiles = await getRecursiveFiles(sub.id, userId);
      filesList = [...filesList, ...subFiles];
    }
  }

  return filesList;
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const { folderId } = await request.json();

    if (!folderId) {
      return NextResponse.json({ error: "Folder ID is required" }, { status: 400 });
    }

    // 1. Verify folder exists and is owned by the user
    const { data: folder, error: fetchError } = await supabase
      .from("folders")
      .select("*")
      .eq("id", folderId)
      .eq("owner_id", userId)
      .single();

    if (fetchError || !folder) {
      return NextResponse.json({ error: "Folder not found or access denied" }, { status: 404 });
    }

    // 2. Get all files in the hierarchy recursively
    const allFiles = await getRecursiveFiles(folderId, userId);

    // 3. Delete files from Cloudflare R2
    for (const file of allFiles) {
      try {
        await deleteFromR2(file.key);
      } catch (r2Error) {
        console.error(`Failed to delete key ${file.key} from R2:`, r2Error);
      }
    }

    // 4. Delete the folder from the database (PostgreSQL will cascade delete subfolders and file records)
    const { error: deleteError } = await supabase
      .from("folders")
      .delete()
      .eq("id", folderId)
      .eq("owner_id", userId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Folder and all contents successfully deleted" });
  } catch (error: any) {
    console.error("Delete folder error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete folder" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// POST: Create a new folder
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const { name, parentId } = await request.json();

    if (!name?.trim()) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }

    // Verify parent folder exists and is owned by the user (if parentId is provided)
    if (parentId && parentId !== "root") {
      const { data: parentFolder, error: parentError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", parentId)
        .eq("owner_id", userId)
        .single();

      if (parentError || !parentFolder) {
        return NextResponse.json({ error: "Parent folder not found or access denied" }, { status: 400 });
      }
    }

    const { data: newFolder, error: insertError } = await supabase
      .from("folders")
      .insert({
        name: name.trim(),
        parent_id: parentId === "root" || !parentId ? null : parentId,
        owner_id: userId,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, folder: newFolder });
  } catch (error: any) {
    console.error("Create folder error:", error);
    return NextResponse.json({ error: error.message || "Failed to create folder" }, { status: 500 });
  }
}

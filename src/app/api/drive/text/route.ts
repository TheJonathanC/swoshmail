import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { uploadToR2, deleteFromR2 } from "@/lib/r2";
import { checkRateLimit } from "@/lib/rate-limit";

const ONE_GB = 1024 * 1024 * 1024; // 1 GB in bytes

export async function POST(request: Request) {
  return handleSaveTextFile(request);
}

export async function PUT(request: Request) {
  return handleSaveTextFile(request);
}

async function handleSaveTextFile(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate Limit: 60 note operations per minute per user
    const rl = checkRateLimit(`drive_text_${userId}`, 60, 60000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment before saving again." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { fileId, name, content, folderId } = body;
    const safeContent = typeof content === "string" ? content : "";
    const buffer = Buffer.from(safeContent, "utf-8");
    const newSize = buffer.length;

    // 1. Fetch current total storage usage across all user files
    const { data: allFiles, error: totalError } = await supabase
      .from("files")
      .select("size")
      .eq("owner_id", userId);

    if (totalError) {
      return NextResponse.json({ error: "Failed to verify storage quota" }, { status: 500 });
    }

    const totalUsed = allFiles.reduce((acc, f) => acc + parseInt(f.size || "0", 10), 0);

    // 2. Handle EDIT / UPDATE existing file
    if (fileId) {
      const { data: existingFile, error: fetchErr } = await supabase
        .from("files")
        .select("*")
        .eq("id", fileId)
        .eq("owner_id", userId)
        .single();

      if (fetchErr || !existingFile) {
        return NextResponse.json({ error: "File not found or access denied" }, { status: 404 });
      }

      // Check quota restriction adjusting for previous file size
      const oldSize = parseInt(existingFile.size || "0", 10);
      if (totalUsed - oldSize + newSize > ONE_GB) {
        return NextResponse.json(
          {
            error: `Storage quota exceeded. Your current limit is 1 GB. Used: ${(totalUsed / 1024 / 1024).toFixed(1)}MB.`,
          },
          { status: 400 }
        );
      }

      // Sanitize new file name if provided, else retain existing
      let targetName = typeof name === "string" && name.trim() ? name.trim() : existingFile.name;
      targetName = targetName.replace(/[/\\?%*:|"<>]/g, "").trim();
      if (!targetName) targetName = existingFile.name;
      // If the file was .txt or name lacks extension, ensure .txt
      if (!targetName.includes(".")) {
        targetName += ".txt";
      }

      // Delete old R2 object
      try {
        await deleteFromR2(existingFile.key);
      } catch (r2Err) {
        console.error("Failed to delete old R2 object during note update:", r2Err);
      }

      // Upload updated content to R2
      const fileKey = `drives/${userId}/${Date.now()}-${targetName}`;
      await uploadToR2(fileKey, buffer, "text/plain; charset=utf-8");

      // Update Supabase record
      const downloadUrl = `/api/drive/download?key=${encodeURIComponent(fileKey)}`;
      const { data: updatedFile, error: updateError } = await supabase
        .from("files")
        .update({
          name: targetName,
          size: newSize,
          key: fileKey,
          url: downloadUrl,
          uploaded_at: new Date().toISOString(),
        })
        .eq("id", fileId)
        .eq("owner_id", userId)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json({ error: "Failed to update file metadata" }, { status: 500 });
      }

      return NextResponse.json({ success: true, file: updatedFile, action: "updated" });
    }

    // 3. Handle CREATE new text file
    if (totalUsed + newSize > ONE_GB) {
      return NextResponse.json(
        {
          error: `Storage quota exceeded. Your current limit is 1 GB. Used: ${(totalUsed / 1024 / 1024).toFixed(1)}MB.`,
        },
        { status: 400 }
      );
    }

    const activeFolderId = !folderId || folderId === "root" ? null : folderId;

    // Sanitize and ensure .txt extension
    let rawName = (typeof name === "string" ? name.trim() : "") || "untitled.txt";
    rawName = rawName.replace(/[/\\?%*:|"<>]/g, "").trim();
    if (!rawName) rawName = "untitled.txt";
    if (!rawName.toLowerCase().endsWith(".txt")) {
      rawName += ".txt";
    }

    // Check sibling files in target folder to avoid accidental naming collisions
    const existingQuery = supabase
      .from("files")
      .select("name")
      .eq("owner_id", userId);

    if (activeFolderId) {
      existingQuery.eq("folder_id", activeFolderId);
    } else {
      existingQuery.is("folder_id", null);
    }

    const { data: siblings } = await existingQuery;
    let finalName = rawName;
    if (siblings && siblings.length > 0) {
      const baseName = rawName.replace(/\.txt$/i, "");
      let counter = 1;
      while (siblings.some((f) => f.name.toLowerCase() === finalName.toLowerCase())) {
        finalName = `${baseName} (${counter}).txt`;
        counter++;
      }
    }

    // Upload to R2
    const fileKey = `drives/${userId}/${Date.now()}-${finalName}`;
    await uploadToR2(fileKey, buffer, "text/plain; charset=utf-8");

    // Insert metadata record in Supabase
    const downloadUrl = `/api/drive/download?key=${encodeURIComponent(fileKey)}`;
    const { data: newFile, error: insertError } = await supabase
      .from("files")
      .insert({
        name: finalName,
        size: newSize,
        key: fileKey,
        url: downloadUrl,
        owner_id: userId,
        folder_id: activeFolderId,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Failed to record file metadata" }, { status: 500 });
    }

    return NextResponse.json({ success: true, file: newFile, action: "created" });
  } catch (error: unknown) {
    console.error("Text file save error:", error);
    const message = error instanceof Error ? error.message : "Failed to save text file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

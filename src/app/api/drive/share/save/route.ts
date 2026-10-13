import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getFileFromR2, uploadToR2 } from "@/lib/r2";
import { verifyShareToken } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";

const ONE_GB = 1024 * 1024 * 1024; // 1 GB in bytes

// POST: Save a shared file directly into the recipient's own Swosh Drive
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Authentication required to save shared files to your drive.", requiresAuth: true },
        { status: 401 }
      );
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkRateLimit(`drive_share_save_${userId}`, 30, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Please wait a moment." }, { status: 429 });
    }

    const body = await request.json();
    const { token, folderId } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Missing share token" }, { status: 400 });
    }

    const verified = verifyShareToken(token);
    if (!verified) {
      return NextResponse.json({ error: "Invalid share link" }, { status: 400 });
    }

    // 1. Fetch source file metadata
    const { data: sourceFile, error: fetchError } = await supabase
      .from("files")
      .select("*")
      .eq("id", verified.fileId)
      .eq("owner_id", verified.ownerId)
      .single();

    if (fetchError || !sourceFile) {
      return NextResponse.json({ error: "The shared file is no longer available." }, { status: 404 });
    }

    const fileSize = parseInt(sourceFile.size || "0", 10);

    // 2. Verify recipient's storage quota
    const { data: recipientFiles, error: totalError } = await supabase
      .from("files")
      .select("size")
      .eq("owner_id", userId);

    if (totalError) {
      return NextResponse.json({ error: "Failed to verify your drive quota" }, { status: 500 });
    }

    const totalUsed = (recipientFiles || []).reduce((acc, f) => acc + parseInt(f.size || "0", 10), 0);

    if (totalUsed + fileSize > ONE_GB) {
      return NextResponse.json(
        {
          error: `Storage quota exceeded. Saving this file would exceed your 1 GB drive limit (Currently used: ${(totalUsed / 1024 / 1024).toFixed(1)} MB).`,
        },
        { status: 400 }
      );
    }

    // 3. Resolve target folder (if any)
    const activeFolderId = !folderId || folderId === "root" ? null : folderId;

    // 4. Resolve filename collisions in recipient's target folder
    const siblingQuery = supabase
      .from("files")
      .select("name")
      .eq("owner_id", userId);

    if (activeFolderId) {
      siblingQuery.eq("folder_id", activeFolderId);
    } else {
      siblingQuery.is("folder_id", null);
    }

    const { data: siblings } = await siblingQuery;
    let finalName = sourceFile.name;
    if (siblings && siblings.length > 0) {
      const extIndex = sourceFile.name.lastIndexOf(".");
      const baseName = extIndex !== -1 ? sourceFile.name.substring(0, extIndex) : sourceFile.name;
      const ext = extIndex !== -1 ? sourceFile.name.substring(extIndex) : "";

      let counter = 1;
      while (siblings.some((f) => f.name.toLowerCase() === finalName.toLowerCase())) {
        finalName = `${baseName} (${counter})${ext}`;
        counter++;
      }
    }

    // 5. Read source file from Cloudflare R2 and copy into recipient's directory
    const r2Response = await getFileFromR2(sourceFile.key);
    const byteArray = await r2Response.Body?.transformToByteArray();
    if (!byteArray) {
      return NextResponse.json({ error: "Failed to read source file from storage" }, { status: 500 });
    }
    const buffer = Buffer.from(byteArray);

    const recipientKey = `drives/${userId}/${Date.now()}-${finalName}`;
    const contentType = r2Response.ContentType || "application/octet-stream";
    await uploadToR2(recipientKey, buffer, contentType);

    // 6. Record metadata in Supabase under recipient's account
    const downloadUrl = `/api/drive/download?key=${encodeURIComponent(recipientKey)}`;
    const { data: newFile, error: insertError } = await supabase
      .from("files")
      .insert({
        name: finalName,
        size: fileSize,
        key: recipientKey,
        url: downloadUrl,
        owner_id: userId,
        folder_id: activeFolderId,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Failed to record file in your drive" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      file: newFile,
      message: `"${finalName}" has been saved to your Swosh Drive.`,
    });
  } catch (error: unknown) {
    console.error("Save shared file error:", error);
    const message = error instanceof Error ? error.message : "Failed to save file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

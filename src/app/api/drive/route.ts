import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/r2";

const ONE_GB = 1024 * 1024 * 1024; // 1 GB in bytes

// GET: Retrieve all files owned by the logged-in user and total storage used
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const { data: files, error } = await supabase
      .from("files")
      .select("*")
      .eq("owner_id", userId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const totalUsed = files.reduce((acc, f) => acc + parseInt(f.size), 0);

    return NextResponse.json({ files, totalUsed });
  } catch (error: any) {
    console.error("GET drive error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch files" }, { status: 500 });
  }
}

// POST: Upload a file to R2 after checking the user's storage quota
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 1. Fetch current storage usage
    const { data: existingFiles, error: fetchError } = await supabase
      .from("files")
      .select("size")
      .eq("owner_id", userId);

    if (fetchError) {
      return NextResponse.json({ error: "Failed to verify quota" }, { status: 500 });
    }

    const totalUsed = existingFiles.reduce((acc, f) => acc + parseInt(f.size), 0);

    // 2. Check quota restriction (1 GB)
    if (totalUsed + file.size > ONE_GB) {
      return NextResponse.json(
        { error: `Storage quota exceeded. Your current limit is 1 GB. Used: ${(totalUsed / 1024 / 1024).toFixed(1)}MB.` },
        { status: 400 }
      );
    }

    // 3. Upload file to Cloudflare R2
    const fileKey = `drives/${userId}/${Date.now()}-${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await uploadToR2(fileKey, buffer, file.type || "application/octet-stream");

    // 4. Save metadata to Database
    const downloadUrl = `/api/drive/download?key=${encodeURIComponent(fileKey)}`;
    const { data: newFile, error: insertError } = await supabase
      .from("files")
      .insert({
        name: file.name,
        size: file.size,
        key: fileKey,
        url: downloadUrl,
        owner_id: userId,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Failed to record file metadata" }, { status: 500 });
    }

    return NextResponse.json({ success: true, file: newFile });
  } catch (error: any) {
    console.error("POST drive error:", error);
    return NextResponse.json({ error: error.message || "File upload failed" }, { status: 500 });
  }
}

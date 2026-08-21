import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/r2";
import { checkRateLimit } from "@/lib/rate-limit";

const ONE_GB = 1024 * 1024 * 1024; // 1 GB in bytes

// Helper to isolate query and prevent TS cyclic inference in the while loop
async function fetchFolder(id: string, userId: string) {
  const res = await supabase
    .from("folders")
    .select("id, name, parent_id")
    .eq("id", id)
    .eq("owner_id", userId)
    .single();
  return res;
}

// Helper to recursively fetch parent folders for breadcrumbs
async function getBreadcrumbs(folderId: string | null, userId: string): Promise<any[]> {
  if (!folderId || folderId === "root") return [];
  const crumbs: any[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const { data: folder } = await fetchFolder(currentId, userId);

    if (folder) {
      crumbs.unshift({ id: folder.id, name: folder.name });
      currentId = folder.parent_id;
    } else {
      break;
    }
  }

  return crumbs;
}

// GET: Retrieve subfolders, files in the current folder, and breadcrumbs
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");
    const activeFolderId = !folderId || folderId === "root" ? null : folderId;

    // 1. Fetch subfolders in active folder
    const foldersQuery = supabase
      .from("folders")
      .select("*")
      .eq("owner_id", userId);
    
    if (activeFolderId) {
      foldersQuery.eq("parent_id", activeFolderId);
    } else {
      foldersQuery.is("parent_id", null);
    }
    
    const { data: subfolders, error: foldersError } = await foldersQuery.order("name", { ascending: true });

    if (foldersError) {
      return NextResponse.json({ error: foldersError.message }, { status: 500 });
    }

    // 2. Fetch files in active folder
    const filesQuery = supabase
      .from("files")
      .select("*")
      .eq("owner_id", userId);

    if (activeFolderId) {
      filesQuery.eq("folder_id", activeFolderId);
    } else {
      filesQuery.is("folder_id", null);
    }

    const { data: files, error: filesError } = await filesQuery.order("uploaded_at", { ascending: false });

    if (filesError) {
      return NextResponse.json({ error: filesError.message }, { status: 500 });
    }

    // 3. Fetch total storage used across all user files
    const { data: allFiles, error: totalError } = await supabase
      .from("files")
      .select("size")
      .eq("owner_id", userId);

    if (totalError) {
      return NextResponse.json({ error: totalError.message }, { status: 500 });
    }

    const totalUsed = allFiles.reduce((acc, f) => acc + parseInt(f.size), 0);

    // 4. Fetch breadcrumbs
    const breadcrumbs = await getBreadcrumbs(activeFolderId, userId);

    return NextResponse.json({
      folders: subfolders || [],
      files: files || [],
      totalUsed,
      breadcrumbs,
    });
  } catch (error: any) {
    console.error("GET drive error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch files" }, { status: 500 });
  }
}

// POST: Upload a file to R2 under a specific folder after checking quota
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // Rate Limit: 20 uploads per minute per user
    const rl = checkRateLimit(`drive_upload_${userId}`, 20, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Too many file uploads." }, { status: 429 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const folderId = formData.get("folderId") as string | null;
    const activeFolderId = !folderId || folderId === "root" ? null : folderId;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 1. Fetch current total storage usage
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
        folder_id: activeFolderId,
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

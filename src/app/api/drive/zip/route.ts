import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getFileFromR2 } from "@/lib/r2";
import { checkRateLimit } from "@/lib/rate-limit";
import JSZip from "jszip";

export const dynamic = "force-dynamic";

interface FileWithPath {
  name: string;
  key: string;
  size: string;
  relativePath: string;
}

// Helper to recursively collect all files and their relative directory paths in a folder
async function getFolderFilesRecursive(
  folderId: string,
  currentPath: string,
  userId: string
): Promise<FileWithPath[]> {
  const result: FileWithPath[] = [];

  // 1. Fetch direct files in this folder
  const { data: files, error: filesError } = await supabase
    .from("files")
    .select("id, name, key, size")
    .eq("owner_id", userId)
    .eq("folder_id", folderId);

  if (!filesError && files && files.length > 0) {
    for (const f of files) {
      result.push({
        name: f.name,
        key: f.key,
        size: f.size,
        relativePath: currentPath ? `${currentPath}/${f.name}` : f.name,
      });
    }
  }

  // 2. Fetch subfolders recursively
  const { data: subfolders, error: subError } = await supabase
    .from("folders")
    .select("id, name")
    .eq("owner_id", userId)
    .eq("parent_id", folderId);

  if (!subError && subfolders && subfolders.length > 0) {
    for (const sub of subfolders) {
      const subPath = currentPath ? `${currentPath}/${sub.name}` : sub.name;
      const nestedFiles = await getFolderFilesRecursive(sub.id, subPath, userId);
      result.push(...nestedFiles);
    }
  }

  return result;
}

// Helper to read file bytes safely from R2 stream
async function getFileBytes(key: string): Promise<Uint8Array | Buffer> {
  const r2Response = await getFileFromR2(key);
  const body = r2Response.Body;
  if (body && typeof (body as unknown as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return await (body as unknown as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  const chunks: Buffer[] = [];
  const stream = body as unknown as AsyncIterable<Uint8Array | Buffer>;
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}


// Helper to prevent filename collisions within a ZIP
function getUniqueZipPath(path: string, existingPaths: Set<string>): string {
  if (!existingPaths.has(path)) {
    existingPaths.add(path);
    return path;
  }
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash !== -1 ? path.slice(0, lastSlash + 1) : "";
  const baseName = lastSlash !== -1 ? path.slice(lastSlash + 1) : path;

  const dotIdx = baseName.lastIndexOf(".");
  const name = dotIdx !== -1 ? baseName.slice(0, dotIdx) : baseName;
  const ext = dotIdx !== -1 ? baseName.slice(dotIdx) : "";

  let counter = 1;
  let candidate = `${dir}${name} (${counter})${ext}`;
  while (existingPaths.has(candidate)) {
    counter++;
    candidate = `${dir}${name} (${counter})${ext}`;
  }
  existingPaths.add(candidate);
  return candidate;
}

// Shared handler for zipping files or folders
async function handleZipRequest(
  userId: string,
  options: { fileIds?: string[]; folderId?: string }
) {
  const { fileIds, folderId } = options;

  let filesToZip: FileWithPath[] = [];
  let zipArchiveName = "swosh-drive-archive.zip";

  if (folderId) {
    // 1. Verify folder exists and belongs to user
    const { data: folder, error: folderError } = await supabase
      .from("folders")
      .select("id, name")
      .eq("id", folderId)
      .eq("owner_id", userId)
      .single();

    if (folderError || !folder) {
      return NextResponse.json({ error: "Folder not found or access denied." }, { status: 404 });
    }

    zipArchiveName = `${folder.name.replace(/[/\\?%*:|"<>]/g, "_")}.zip`;

    // 2. Fetch all files in folder hierarchy recursively
    filesToZip = await getFolderFilesRecursive(folderId, "", userId);

    if (filesToZip.length === 0) {
      return NextResponse.json(
        { error: `Folder "${folder.name}" is empty. No files to download.` },
        { status: 400 }
      );
    }
  } else if (fileIds && fileIds.length > 0) {
    // 1. Fetch requested files belonging to user
    const { data: files, error: filesError } = await supabase
      .from("files")
      .select("id, name, key, size")
      .in("id", fileIds)
      .eq("owner_id", userId);

    if (filesError || !files || files.length === 0) {
      return NextResponse.json({ error: "No matching files found or access denied." }, { status: 404 });
    }

    filesToZip = files.map((f) => ({
      name: f.name,
      key: f.key,
      size: f.size,
      relativePath: f.name,
    }));

    const dateStamp = new Date().toISOString().slice(0, 10);
    zipArchiveName = filesToZip.length === 1
      ? `${filesToZip[0].name.replace(/\.[^/.]+$/, "")}.zip`
      : `swosh-drive-selected-${dateStamp}.zip`;
  } else {
    return NextResponse.json({ error: "Either folderId or fileIds must be provided." }, { status: 400 });
  }

  // Build the ZIP archive
  const zip = new JSZip();
  const existingPaths = new Set<string>();

  for (const item of filesToZip) {
    try {
      const fileBytes = await getFileBytes(item.key);
      const uniquePath = getUniqueZipPath(item.relativePath, existingPaths);
      zip.file(uniquePath, fileBytes);
    } catch (err) {
      console.error(`Failed to fetch file key "${item.key}" for zip:`, err);
      // Continue packing remaining files
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return new Response(zipBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(zipArchiveName)}"`,
      "Content-Length": zipBuffer.length.toString(),
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

// GET: /api/drive/zip?folderId=xxx OR ?fileIds=id1,id2
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate Limit: 20 ZIP operations per minute
    const rl = checkRateLimit(`drive_zip_${userId}`, 20, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Too many ZIP download requests." }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId") || undefined;
    const fileIdsParam = searchParams.get("fileIds");
    const fileIds = fileIdsParam ? fileIdsParam.split(",").filter(Boolean) : undefined;

    return await handleZipRequest(userId, { folderId, fileIds });
  } catch (error: unknown) {
    console.error("GET /api/drive/zip error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate ZIP archive.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: /api/drive/zip with { folderId?: string, fileIds?: string[] }
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

    // Rate Limit: 20 ZIP operations per minute
    const rl = checkRateLimit(`drive_zip_${userId}`, 20, 60000);
    if (!rl.success) {
      return NextResponse.json({ error: "Rate limit exceeded. Too many ZIP download requests." }, { status: 429 });
    }

    const body = await request.json();
    const { folderId, fileIds } = body;

    return await handleZipRequest(userId, { folderId, fileIds });
  } catch (error: unknown) {
    console.error("POST /api/drive/zip error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate ZIP archive.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


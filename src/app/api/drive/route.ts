import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, notFound, parseFolderId, readForm, route, tooLarge } from "@/lib/http";
import {
  assertFolderOwned,
  FILE_COLUMNS,
  FOLDER_COLUMNS,
  getOwnedFile,
  getTotalUsed,
  newObjectKey,
  replaceFileObject,
  resolveUniqueName,
  storeFile,
  toFileItem,
  toFolderItem,
  type FileRow,
} from "@/lib/drive";
import { putObject } from "@/lib/r2";
import { sanitizeFileName } from "@/lib/files";
import { DRIVE_QUOTA_BYTES, MAX_MULTIPART_UPLOAD_BYTES } from "@/lib/constants";
import type { Breadcrumb, DriveListResponse, FolderItem, UploadCompleteResponse } from "@/types/api";

// GET /api/drive?folderId=<uuid|root>
export const GET = route("GET /api/drive", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_list_${user.id}`, 120, MINUTE);

  const folderId = parseFolderId(new URL(request.url).searchParams.get("folderId"));

  let foldersQ = supabase.from("folders").select(FOLDER_COLUMNS).eq("owner_id", user.id);
  foldersQ = folderId ? foldersQ.eq("parent_id", folderId) : foldersQ.is("parent_id", null);
  let filesQ = supabase.from("files").select(FILE_COLUMNS).eq("owner_id", user.id);
  filesQ = folderId ? filesQ.eq("folder_id", folderId) : filesQ.is("folder_id", null);

  const [foldersRes, filesRes, totalUsed, crumbsRes] = await Promise.all([
    foldersQ.order("name", { ascending: true }),
    filesQ.order("uploaded_at", { ascending: false }),
    getTotalUsed(user.id),
    folderId
      ? supabase.rpc("folder_breadcrumbs", { p_folder_id: folderId, p_owner_id: user.id })
      : Promise.resolve({ data: [] as Breadcrumb[], error: null }),
  ]);

  const folders = (check(foldersRes, "list folders") ?? []) as FolderItem[];
  const files = (check(filesRes, "list files") ?? []) as FileRow[];
  const breadcrumbs = (check(crumbsRes, "breadcrumbs") ?? []) as Breadcrumb[];
  if (folderId && breadcrumbs.length === 0) throw notFound("Folder not found.", "folder_not_found");

  const body: DriveListResponse = {
    folders: folders.map(toFolderItem),
    files: files.map(toFileItem),
    breadcrumbs: breadcrumbs.map((b) => ({ id: b.id, name: b.name })),
    totalUsed,
    quota: DRIVE_QUOTA_BYTES,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
});

// POST /api/drive (multipart fallback for files <= 4 MB): fields file, folderId?, replaceFileId?
export const POST = route("POST /api/drive", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_upload_${user.id}`, 60, MINUTE, "Too many uploads. Please wait a moment.");

  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > MAX_MULTIPART_UPLOAD_BYTES + 64 * 1024) {
    throw tooLarge("This file is too large for a direct upload.", "too_large");
  }

  const form = await readForm(request);
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file provided.");
  if (file.size > MAX_MULTIPART_UPLOAD_BYTES) throw tooLarge("This file is too large for a direct upload.", "too_large");

  const folderId = parseFolderId(form.get("folderId"));
  const replaceRaw = form.get("replaceFileId");
  const replaceFileId = replaceRaw ? parseFolderId(replaceRaw, "replaceFileId") : null;
  const name = sanitizeFileName(file.name, "upload");
  const contentType = (file.type || "application/octet-stream").slice(0, 255);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (replaceFileId) {
    const existing = await getOwnedFile(user.id, replaceFileId);
    const used = await getTotalUsed(user.id);
    if (used - (Number(existing.size) || 0) + bytes.byteLength > DRIVE_QUOTA_BYTES) {
      throw tooLarge("Storage quota exceeded. Your Swosh Drive limit is 1 GB.", "quota_exceeded");
    }
    // New object first, then row, then delete the old object (inside replaceFileObject).
    const key = newObjectKey(user.id);
    await putObject(key, bytes, contentType);
    const row = await replaceFileObject(user.id, existing, { key, size: bytes.byteLength, name, contentType });
    const body: UploadCompleteResponse = { file: toFileItem(row), totalUsed: await getTotalUsed(user.id), replaced: true };
    return NextResponse.json(body);
  }

  await assertFolderOwned(user.id, folderId);
  const used = await getTotalUsed(user.id);
  if (used + bytes.byteLength > DRIVE_QUOTA_BYTES) {
    throw tooLarge("Storage quota exceeded. Your Swosh Drive limit is 1 GB.", "quota_exceeded");
  }
  const finalName = await resolveUniqueName(user.id, folderId, name);
  const row = await storeFile({ userId: user.id, name: finalName, folderId, body: bytes, contentType });
  const body: UploadCompleteResponse = { file: toFileItem(row), totalUsed: await getTotalUsed(user.id), replaced: false };
  return NextResponse.json(body);
});

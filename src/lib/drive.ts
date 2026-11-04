/**
 * Server-side Swosh Drive helpers: ownership checks, quota reads, object keys and
 * the storeFile() write path with rollback.
 */
import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabase";
import { deleteObjectQuietly, putObject } from "@/lib/r2";
import {
  check,
  conflict,
  HttpError,
  isForeignKeyViolation,
  isQuotaViolation,
  isUniqueViolation,
  notFound,
  quotaExceeded,
} from "@/lib/http";
import { DRIVE_QUOTA_BYTES } from "@/lib/constants";
import { uniqueName } from "@/lib/files";
import type { FileItem, FolderItem } from "@/types/api";

export const FILE_COLUMNS = "id, name, size, owner_id, uploaded_at, folder_id, content_type, key";
export const FOLDER_COLUMNS = "id, name, parent_id, owner_id, created_at";

export interface FileRow {
  id: string;
  name: string;
  size: number | string;
  owner_id: string;
  uploaded_at: string;
  folder_id: string | null;
  content_type?: string | null;
  key: string;
}

export function toFileItem(row: FileRow): FileItem {
  return {
    id: row.id,
    name: row.name,
    size: Number(row.size) || 0,
    owner_id: row.owner_id,
    uploaded_at: row.uploaded_at,
    folder_id: row.folder_id ?? null,
    content_type: row.content_type ?? null,
  };
}

export function toFolderItem(row: FolderItem): FolderItem {
  return {
    id: row.id,
    name: row.name,
    parent_id: row.parent_id ?? null,
    owner_id: row.owner_id,
    created_at: row.created_at,
  };
}

/** Object key: never contains user input. Display names live only in the DB. */
export function newObjectKey(userId: string): string {
  return `drives/${userId}/${randomUUID()}`;
}

export function downloadPath(fileId: string): string {
  return `/api/drive/download?fileId=${fileId}`;
}

/** Storage used, maintained atomically by the files trigger (users.storage_used). */
export async function getTotalUsed(userId: string): Promise<number> {
  const data = check(
    await supabase.from("users").select("storage_used").eq("id", userId).maybeSingle(),
    "read storage_used"
  );
  return Number((data as { storage_used?: number | string } | null)?.storage_used ?? 0);
}

/** Throws 404 unless folderId is null (root) or a folder owned by userId. */
export async function assertFolderOwned(userId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const data = check(
    await supabase.from("folders").select("id").eq("id", folderId).eq("owner_id", userId).maybeSingle(),
    "assertFolderOwned"
  );
  if (!data) throw notFound("Folder not found.", "folder_not_found");
}

export async function getOwnedFile(userId: string, fileId: string): Promise<FileRow> {
  const data = check(
    await supabase.from("files").select(FILE_COLUMNS).eq("id", fileId).eq("owner_id", userId).maybeSingle(),
    "getOwnedFile"
  );
  if (!data) throw notFound("File not found.");
  return data as FileRow;
}

/** Names of files in a folder (for collision handling). */
export async function siblingFileNames(userId: string, folderId: string | null, excludeId?: string): Promise<string[]> {
  let q = supabase.from("files").select("id, name").eq("owner_id", userId);
  q = folderId ? q.eq("folder_id", folderId) : q.is("folder_id", null);
  const rows = check(await q, "siblingFileNames") as { id: string; name: string }[] | null;
  return (rows ?? []).filter((r) => r.id !== excludeId).map((r) => r.name);
}

export async function resolveUniqueName(userId: string, folderId: string | null, name: string): Promise<string> {
  return uniqueName(name, await siblingFileNames(userId, folderId));
}

/** Maps a files insert/update error to an HttpError. */
export function fileWriteError(err: { code?: string; message?: string } | null, context: string): HttpError {
  if (isQuotaViolation(err)) return quotaExceeded();
  if (isForeignKeyViolation(err)) return notFound("Folder not found.", "folder_not_found");
  if (isUniqueViolation(err)) return conflict("This upload was already recorded.", "duplicate");
  console.error(`[db] ${context}:`, err);
  return new HttpError(500, "Could not save the file. Please try again.", "server_error");
}

export interface InsertFileInput {
  id?: string;
  userId: string;
  name: string;
  size: number;
  key: string;
  folderId: string | null;
  contentType: string | null;
}

/**
 * Inserts a files row for an object that already exists in storage. On failure the
 * object is deleted (rollback) and the mapped HttpError is thrown. Quota is enforced
 * atomically by the DB trigger.
 */
export async function insertFileRow(input: InsertFileInput): Promise<FileRow> {
  if (input.size > DRIVE_QUOTA_BYTES) {
    await deleteObjectQuietly(input.key);
    throw quotaExceeded();
  }
  const id = input.id ?? randomUUID();
  const { data, error } = await supabase
    .from("files")
    .insert({
      id,
      name: input.name,
      size: input.size,
      key: input.key,
      url: downloadPath(id),
      owner_id: input.userId,
      folder_id: input.folderId,
      content_type: input.contentType,
    })
    .select(FILE_COLUMNS)
    .single();
  if (error || !data) {
    // A unique violation on key means this object is already recorded: keep it.
    if (!isUniqueViolation(error)) await deleteObjectQuietly(input.key);
    throw fileWriteError(error, "insert file");
  }
  return data as FileRow;
}

export interface StoreFileInput {
  userId: string;
  name: string;
  folderId: string | null;
  body: Buffer | Uint8Array;
  contentType?: string | null;
}

/**
 * Uploads bytes to a fresh UUID key and records the row; rolls the object back if
 * the DB insert fails (quota, missing folder, ...). Caller resolves name collisions.
 */
export async function storeFile(input: StoreFileInput): Promise<FileRow> {
  const key = newObjectKey(input.userId);
  const contentType = input.contentType || "application/octet-stream";
  await putObject(key, input.body, contentType);
  return insertFileRow({
    userId: input.userId,
    name: input.name,
    size: input.body.byteLength,
    key,
    folderId: input.folderId,
    contentType,
  });
}

/**
 * Points an existing row at a new object (already uploaded), then deletes the old
 * object last. If the update fails the new object is rolled back and the old file
 * stays intact.
 */
export async function replaceFileObject(
  userId: string,
  existing: FileRow,
  next: { key: string; size: number; name?: string; contentType: string | null }
): Promise<FileRow> {
  const { data, error } = await supabase
    .from("files")
    .update({
      key: next.key,
      size: next.size,
      name: next.name ?? existing.name,
      content_type: next.contentType,
      url: downloadPath(existing.id),
      uploaded_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("owner_id", userId)
    .select(FILE_COLUMNS)
    .maybeSingle();
  if (error || !data) {
    await deleteObjectQuietly(next.key);
    if (!error) throw notFound("File not found.");
    throw fileWriteError(error, "replace file");
  }
  if (existing.key !== next.key) await deleteObjectQuietly(existing.key);
  return data as FileRow;
}

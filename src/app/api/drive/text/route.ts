import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, conflict, parseFolderId, readJson, requireUuid, route, tooLarge } from "@/lib/http";
import {
  assertFolderOwned,
  getOwnedFile,
  getTotalUsed,
  newObjectKey,
  replaceFileObject,
  siblingFileNames,
  storeFile,
  toFileItem,
} from "@/lib/drive";
import { getObjectText, putObject } from "@/lib/r2";
import { getExtension, sanitizeFileName } from "@/lib/files";
import { EDITABLE_TEXT_EXTENSIONS, MAX_TEXT_FILE_BYTES } from "@/lib/constants";
import type { TextSaveResponse } from "@/types/api";

const TEXT_TYPE = "text/plain; charset=utf-8";

function normalizeTextName(input: unknown, fallback: string): string {
  let name = sanitizeFileName(typeof input === "string" && input.trim() ? input : fallback, fallback);
  if (!getExtension(name)) name = sanitizeFileName(`${name}.txt`, "untitled.txt");
  if (!EDITABLE_TEXT_EXTENSIONS.has(getExtension(name))) {
    throw badRequest("Only text files (.txt, .md, .json, .csv, ...) can be edited.", "not_editable");
  }
  return name;
}

function encodeContent(content: unknown): Buffer {
  if (content !== undefined && typeof content !== "string") throw badRequest("content must be a string.");
  const buf = Buffer.from(content ?? "", "utf-8");
  if (buf.byteLength > MAX_TEXT_FILE_BYTES) throw tooLarge("Notes can be at most 1 MB.", "too_large");
  return buf;
}

function hasName(names: string[], name: string): boolean {
  const lower = name.toLowerCase();
  return names.some((n) => n.toLowerCase() === lower);
}

// GET /api/drive/text?fileId= -> { content, name }
export const GET = route("GET /api/drive/text", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_text_read_${user.id}`, 120, MINUTE);
  const fileId = requireUuid(new URL(request.url).searchParams.get("fileId"), "fileId");
  const file = await getOwnedFile(user.id, fileId);
  if (!EDITABLE_TEXT_EXTENSIONS.has(getExtension(file.name))) {
    throw badRequest("This file type cannot be edited.", "not_editable");
  }
  if ((Number(file.size) || 0) > MAX_TEXT_FILE_BYTES) throw tooLarge("This file is too large to edit (max 1 MB).", "too_large");
  const content = await getObjectText(file.key);
  return NextResponse.json({ content, name: file.name }, { headers: { "Cache-Control": "private, no-store" } });
});

// POST /api/drive/text { name, content, folderId } -> { file, totalUsed }
export const POST = route("POST /api/drive/text", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_text_${user.id}`, 60, MINUTE, "Too many saves. Please wait a moment.");
  const body = await readJson<{ name: string; content: string; folderId: string | null }>(request, 2 * MAX_TEXT_FILE_BYTES);

  const bytes = encodeContent(body.content);
  const name = normalizeTextName(body.name, "untitled.txt");
  const folderId = parseFolderId(body.folderId);
  await assertFolderOwned(user.id, folderId);
  if (hasName(await siblingFileNames(user.id, folderId), name)) {
    throw conflict("A file with this name already exists in this folder.", "name_conflict");
  }

  const row = await storeFile({ userId: user.id, name, folderId, body: bytes, contentType: TEXT_TYPE });
  const res: TextSaveResponse = { file: toFileItem(row), totalUsed: await getTotalUsed(user.id) };
  return NextResponse.json(res);
});

// PUT /api/drive/text { fileId, name, content } -> { file, totalUsed }
export const PUT = route("PUT /api/drive/text", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_text_${user.id}`, 60, MINUTE, "Too many saves. Please wait a moment.");
  const body = await readJson<{ fileId: string; name: string; content: string }>(request, 2 * MAX_TEXT_FILE_BYTES);

  const fileId = requireUuid(body.fileId, "fileId");
  const bytes = encodeContent(body.content);
  const existing = await getOwnedFile(user.id, fileId);
  if (!EDITABLE_TEXT_EXTENSIONS.has(getExtension(existing.name))) {
    throw badRequest("This file type cannot be edited.", "not_editable");
  }
  const name = normalizeTextName(body.name, existing.name);
  if (name.toLowerCase() !== existing.name.toLowerCase()) {
    if (hasName(await siblingFileNames(user.id, existing.folder_id, existing.id), name)) {
      throw conflict("A file with this name already exists in this folder.", "name_conflict");
    }
  }

  // New object first -> row update (quota enforced by trigger) -> old object deleted last.
  const key = newObjectKey(user.id);
  await putObject(key, bytes, TEXT_TYPE);
  const row = await replaceFileObject(user.id, existing, { key, size: bytes.byteLength, name, contentType: TEXT_TYPE });
  const res: TextSaveResponse = { file: toFileItem(row), totalUsed: await getTotalUsed(user.id) };
  return NextResponse.json(res);
});

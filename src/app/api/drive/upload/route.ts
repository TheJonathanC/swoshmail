import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, conflict, HttpError, parseFolderId, quotaExceeded, readJson, route, tooLarge } from "@/lib/http";
import {
  assertFolderOwned,
  FILE_COLUMNS,
  type FileRow,
  getOwnedFile,
  getTotalUsed,
  insertFileRow,
  newObjectKey,
  replaceFileObject,
  resolveUniqueName,
  toFileItem,
} from "@/lib/drive";
import { deleteObjectQuietly, headObject, presignPut } from "@/lib/r2";
import { sanitizeFileName } from "@/lib/files";
import { signUploadToken, verifyUploadToken } from "@/lib/upload-token";
import { DRIVE_QUOTA_BYTES, MAX_UPLOAD_BYTES, UPLOAD_URL_TTL_SECONDS } from "@/lib/constants";
import type {
  UploadCompleteRequest,
  UploadCompleteResponse,
  UploadInitRequest,
  UploadInitResponse,
} from "@/types/api";

const CONTENT_TYPE_RE = /^[\w.+-]+\/[\w.+-]+$/;

function safeContentType(type: unknown): string {
  if (typeof type === "string" && type.length <= 127 && CONTENT_TYPE_RE.test(type)) return type.toLowerCase();
  return "application/octet-stream";
}

async function init(userId: string, body: Partial<UploadInitRequest>): Promise<Response> {
  await enforceRateLimit(`drive_upload_${userId}`, 60, MINUTE, "Too many uploads. Please wait a moment.");

  const size = Number(body.size);
  if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) throw badRequest("Invalid file size.");
  if (size > MAX_UPLOAD_BYTES) throw tooLarge("This file is larger than the 1 GB limit.", "too_large");
  const name = sanitizeFileName(body.name, "upload");
  const contentType = safeContentType(body.type);
  const folderId = parseFolderId(body.folderId);
  const replaceFileId = body.replaceFileId ? parseFolderId(body.replaceFileId, "replaceFileId") : null;

  const used = await getTotalUsed(userId);
  let finalName = name;
  if (replaceFileId) {
    const existing = await getOwnedFile(userId, replaceFileId);
    if (used - (Number(existing.size) || 0) + size > DRIVE_QUOTA_BYTES) throw quotaExceeded();
  } else {
    await assertFolderOwned(userId, folderId);
    if (used + size > DRIVE_QUOTA_BYTES) throw quotaExceeded();
    finalName = await resolveUniqueName(userId, folderId, name);
  }

  const key = newObjectKey(userId);
  const uploadUrl = await presignPut(key, contentType, size, UPLOAD_URL_TTL_SECONDS);
  const uploadToken = signUploadToken({
    u: userId,
    k: key,
    n: finalName,
    f: replaceFileId ? null : folderId,
    r: replaceFileId,
    t: contentType,
    s: size,
    // Allow time for the PUT itself after the URL expires at the latest.
    e: Math.floor(Date.now() / 1000) + UPLOAD_URL_TTL_SECONDS + 6 * 60 * 60,
  });

  const res: UploadInitResponse = { uploadUrl, headers: { "Content-Type": contentType }, uploadToken };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}

async function complete(userId: string, body: Partial<UploadCompleteRequest>): Promise<Response> {
  await enforceRateLimit(`drive_upload_complete_${userId}`, 120, MINUTE);

  const token = verifyUploadToken(body.uploadToken);
  if (!token || token.u !== userId) throw badRequest("Upload expired or invalid. Please try again.", "invalid_token");

  const head = await headObject(token.k);
  if (!head) throw badRequest("The upload did not reach Swosh Drive. Please try again.", "upload_missing");
  const realSize = head.size;
  if (realSize !== token.s) {
    await deleteObjectQuietly(token.k);
    throw badRequest("The uploaded file didn't match what was announced. Please try again.", "invalid_token");
  }
  if (realSize > MAX_UPLOAD_BYTES) {
    await deleteObjectQuietly(token.k);
    throw tooLarge("This file is larger than the 1 GB limit.", "too_large");
  }

  if (token.r) {
    let existing;
    try {
      existing = await getOwnedFile(userId, token.r);
    } catch (err) {
      await deleteObjectQuietly(token.k);
      throw err;
    }
    if (existing.key === token.k) {
      // Already completed (retry): idempotent success.
      const res: UploadCompleteResponse = { file: toFileItem(existing), totalUsed: await getTotalUsed(userId), replaced: true };
      return NextResponse.json(res);
    }
    // Quota is enforced atomically by the DB trigger on the size change.
    const row = await replaceFileObject(userId, existing, { key: token.k, size: realSize, name: token.n, contentType: token.t });
    const res: UploadCompleteResponse = { file: toFileItem(row), totalUsed: await getTotalUsed(userId), replaced: true };
    return NextResponse.json(res);
  }

  const already = check(
    await supabase.from("files").select(FILE_COLUMNS).eq("key", token.k).eq("owner_id", userId).maybeSingle(),
    "complete lookup"
  ) as FileRow | null;
  if (already) {
    const res: UploadCompleteResponse = { file: toFileItem(already), totalUsed: await getTotalUsed(userId), replaced: false };
    return NextResponse.json(res);
  }

  try {
    const row = await insertFileRow({
      userId,
      name: token.n,
      size: realSize,
      key: token.k,
      folderId: token.f,
      contentType: token.t,
    });
    const res: UploadCompleteResponse = { file: toFileItem(row), totalUsed: await getTotalUsed(userId), replaced: false };
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof HttpError && err.code === "duplicate") {
      throw conflict("This upload was already completed.", "duplicate");
    }
    throw err;
  }
}

// POST /api/drive/upload { action: "init" | "complete", ... }
export const POST = route("POST /api/drive/upload", async (request: Request) => {
  const user = await requireUser();
  const body = await readJson<UploadInitRequest | UploadCompleteRequest>(request, 64 * 1024);
  const action = (body as { action?: unknown }).action;
  if (action === "init") return init(user.id, body as Partial<UploadInitRequest>);
  if (action === "complete") return complete(user.id, body as Partial<UploadCompleteRequest>);
  throw badRequest('action must be "init" or "complete".');
});

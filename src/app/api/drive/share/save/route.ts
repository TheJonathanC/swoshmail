import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { parseFolderId, quotaExceeded, readJson, route } from "@/lib/http";
import { resolveShare } from "@/lib/shares";
import {
  assertFolderOwned,
  getTotalUsed,
  insertFileRow,
  newObjectKey,
  resolveUniqueName,
  toFileItem,
} from "@/lib/drive";
import { copyObject } from "@/lib/r2";
import { mimeForName, sanitizeFileName } from "@/lib/files";
import { DRIVE_QUOTA_BYTES } from "@/lib/constants";
import type { TextSaveResponse } from "@/types/api";

// POST /api/drive/share/save { token, folderId } -> { file, totalUsed }
export const POST = route("POST /api/drive/share/save", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_share_save_${user.id}`, 20, MINUTE, "Too many saves. Please wait a moment.");
  const body = await readJson<{ token: string; folderId: string | null }>(request);
  const { file } = await resolveShare(body.token, user.id);
  const folderId = parseFolderId(body.folderId);
  await assertFolderOwned(user.id, folderId);

  // Early friendly check; the files trigger enforces the quota atomically on insert.
  if ((await getTotalUsed(user.id)) + file.size > DRIVE_QUOTA_BYTES) throw quotaExceeded();

  const name = await resolveUniqueName(user.id, folderId, sanitizeFileName(file.name, "shared-file"));
  const key = newObjectKey(user.id);
  await copyObject(file.key, key); // server-side copy, no bytes through this process
  const row = await insertFileRow({
    userId: user.id,
    name,
    size: file.size,
    key,
    folderId,
    contentType: mimeForName(name),
  }); // rolls the copied object back on failure

  const res: TextSaveResponse = { file: toFileItem(row), totalUsed: await getTotalUsed(user.id) };
  return NextResponse.json(res);
});

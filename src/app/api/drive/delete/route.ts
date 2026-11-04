import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, isUuid, notFound, readJson, route, tooLarge } from "@/lib/http";
import { getTotalUsed } from "@/lib/drive";
import { deleteObjects } from "@/lib/r2";
import { MAX_BATCH_IDS } from "@/lib/constants";
import type { FileDeleteResponse } from "@/types/api";

// POST /api/drive/delete { fileIds: string[] } (legacy: { fileId })
export const POST = route("POST /api/drive/delete", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_delete_${user.id}`, 60, MINUTE, "Too many delete requests. Please wait a moment.");

  const body = await readJson<{ fileIds: unknown[]; fileId: string }>(request);
  const raw: unknown[] = Array.isArray(body.fileIds) ? body.fileIds : body.fileId !== undefined ? [body.fileId] : [];
  if (raw.length === 0) throw badRequest("No files selected.");
  if (raw.length > MAX_BATCH_IDS) throw tooLarge(`You can delete at most ${MAX_BATCH_IDS} files at once.`);
  if (!raw.every(isUuid)) throw badRequest("Invalid file id.");
  const ids = Array.from(new Set((raw as string[]).map((s) => s.toLowerCase())));

  // DB first (returns the keys of exactly the rows we removed), then storage.
  const rows = check(
    await supabase.from("files").delete().in("id", ids).eq("owner_id", user.id).select("id, key"),
    "delete files"
  ) as { id: string; key: string }[];
  if (!rows || rows.length === 0) throw notFound("Files not found.");

  await deleteObjects(rows.map((r) => r.key));

  const res: FileDeleteResponse = { success: true, deleted: rows.length, totalUsed: await getTotalUsed(user.id) };
  return NextResponse.json(res);
});

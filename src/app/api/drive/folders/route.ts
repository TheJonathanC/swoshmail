import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { isForeignKeyViolation, notFound, parseFolderId, readJson, route, serverError } from "@/lib/http";
import { assertFolderOwned, FOLDER_COLUMNS, toFolderItem } from "@/lib/drive";
import { validateFolderName } from "@/lib/folders";
import type { CreateFolderResponse, FolderItem } from "@/types/api";

// POST /api/drive/folders { name, parentId } -> { folder }
export const POST = route("POST /api/drive/folders", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_folder_${user.id}`, 60, MINUTE, "Too many folder operations. Please wait a moment.");

  const body = await readJson<{ name: string; parentId: string | null }>(request);
  const name = validateFolderName(body.name);
  const parentId = parseFolderId(body.parentId, "parentId");
  await assertFolderOwned(user.id, parentId);

  const { data, error } = await supabase
    .from("folders")
    .insert({ name, parent_id: parentId, owner_id: user.id })
    .select(FOLDER_COLUMNS)
    .single();
  if (error || !data) {
    if (isForeignKeyViolation(error)) throw notFound("Parent folder not found.", "folder_not_found");
    return serverError("create folder", error, "Could not create the folder.");
  }
  const res: CreateFolderResponse = { folder: toFolderItem(data as FolderItem) };
  return NextResponse.json(res);
});

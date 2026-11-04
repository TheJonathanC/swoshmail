import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { check, notFound, readJson, requireUuid, route } from "@/lib/http";
import { getTotalUsed } from "@/lib/drive";
import { getFolderTree } from "@/lib/folders";
import { deleteObjects } from "@/lib/r2";
import type { FolderDeletePreview, FolderDeleteResponse } from "@/types/api";

// GET /api/drive/folders/delete?folderId= -> counts for the confirm dialog
export const GET = route("GET /api/drive/folders/delete", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_folder_preview_${user.id}`, 60, MINUTE);
  const folderId = requireUuid(new URL(request.url).searchParams.get("folderId"), "folderId");

  const tree = await getFolderTree(folderId, user.id);
  if (!tree) throw notFound("Folder not found.", "folder_not_found");
  const res: FolderDeletePreview = {
    files: tree.files.length,
    // Descendant folders, excluding the folder itself.
    folders: Math.max(0, tree.folders.length - 1),
    bytes: tree.files.reduce((sum, f) => sum + f.size, 0),
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
});

// POST /api/drive/folders/delete { folderId }
export const POST = route("POST /api/drive/folders/delete", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_delete_${user.id}`, 60, MINUTE, "Too many delete requests. Please wait a moment.");
  const body = await readJson<{ folderId: string }>(request);
  const folderId = requireUuid(body.folderId, "folderId");

  // 1. Collect the whole tree (one RPC) so we know which objects to remove.
  const tree = await getFolderTree(folderId, user.id);
  if (!tree) throw notFound("Folder not found.", "folder_not_found");

  // 2. Delete DB rows first. Files are deleted explicitly (RETURNING their keys, so we
  //    remove exactly what was deleted), then the folder row, which cascades to
  //    sub-folders and anything uploaded concurrently. If this fails, storage is untouched.
  const folderIds = tree.folders.map((f) => f.id);
  const deletedFiles: { key: string }[] = [];
  for (let i = 0; i < folderIds.length; i += 200) {
    const rows = check(
      await supabase
        .from("files")
        .delete()
        .eq("owner_id", user.id)
        .in("folder_id", folderIds.slice(i, i + 200))
        .select("key"),
      "delete folder files"
    ) as { key: string }[];
    deletedFiles.push(...(rows ?? []));
  }
  const deleted = check(
    await supabase.from("folders").delete().eq("id", folderId).eq("owner_id", user.id).select("id"),
    "delete folder"
  ) as { id: string }[];
  if (!deleted || deleted.length === 0) throw notFound("Folder not found.", "folder_not_found");

  // 3. Then remove objects in batches. Failures are logged as orphans, not surfaced:
  //    the files are already gone from the user's drive.
  const keys = new Set(deletedFiles.map((f) => f.key));
  for (const f of tree.files) keys.add(f.key); // rows removed by cascade in a race
  await deleteObjects(Array.from(keys));

  const res: FolderDeleteResponse = {
    success: true,
    deletedFiles: deletedFiles.length,
    deletedFolders: tree.folders.length,
    totalUsed: await getTotalUsed(user.id),
  };
  return NextResponse.json(res);
});

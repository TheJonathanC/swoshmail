import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, parseFolderId, readJson, route, tooLarge } from "@/lib/http";
import { assertFolderOwned } from "@/lib/drive";
import { validateFolderName } from "@/lib/folders";
import { MAX_FOLDER_TREE_PATHS } from "@/lib/constants";
import type { CreateFolderTreeResponse } from "@/types/api";

/** Normalizes "a\\b/./c/" to ["a","b","c"] with each segment validated. */
function splitPath(path: string): string[] {
  const segments = path
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== ".");
  if (segments.some((s) => s === "..")) throw badRequest("Folder paths may not contain '..'.");
  return segments.map(validateFolderName);
}

// POST /api/drive/folders/tree { parentId, rootName, paths } -> { rootId, folderIds }
export const POST = route("POST /api/drive/folders/tree", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_folder_tree_${user.id}`, 20, MINUTE, "Too many folder uploads. Please wait a moment.");

  const body = await readJson<{ parentId: string | null; rootName: string; paths: string[] }>(request, 2 * 1024 * 1024);
  const parentId = parseFolderId(body.parentId, "parentId");
  const rootName = validateFolderName(body.rootName);
  if (body.paths !== undefined && !Array.isArray(body.paths)) throw badRequest("paths must be an array.");
  const rawPaths = (body.paths ?? []).filter((p): p is string => typeof p === "string");
  if (rawPaths.length > MAX_FOLDER_TREE_PATHS) throw tooLarge(`A folder upload can contain at most ${MAX_FOLDER_TREE_PATHS} folders.`);

  await assertFolderOwned(user.id, parentId);

  // Expand every path to include its ancestors, keyed by the client's original spelling
  // of each prefix (normalized with "/"), so the response maps exactly what was sent.
  const wanted = new Map<string, string[]>(); // relKey -> segments
  for (const raw of rawPaths) {
    const segs = splitPath(raw);
    for (let i = 1; i <= segs.length; i++) {
      const key = segs.slice(0, i).join("/");
      if (!wanted.has(key)) wanted.set(key, segs.slice(0, i));
    }
  }
  if (wanted.size > MAX_FOLDER_TREE_PATHS) throw tooLarge(`A folder upload can contain at most ${MAX_FOLDER_TREE_PATHS} folders.`);

  const root = check(
    await supabase.from("folders").insert({ name: rootName, parent_id: parentId, owner_id: user.id }).select("id").single(),
    "create tree root"
  ) as { id: string };

  const folderIds: Record<string, string> = { "": root.id };
  // Create level by level (one insert per depth).
  const byDepth = new Map<number, string[]>();
  for (const [key, segs] of wanted) {
    const list = byDepth.get(segs.length) ?? [];
    list.push(key);
    byDepth.set(segs.length, list);
  }
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  try {
    for (const depth of depths) {
      const keys = byDepth.get(depth)!;
      // Ids are generated here so the mapping never depends on RETURNING order.
      const rows = keys.map((key) => {
        const segs = wanted.get(key)!;
        const parentKey = segs.slice(0, -1).join("/");
        const id = randomUUID();
        folderIds[key] = id;
        return { id, name: segs[segs.length - 1], parent_id: folderIds[parentKey], owner_id: user.id };
      });
      check(await supabase.from("folders").insert(rows), "create tree level");
    }
  } catch (err) {
    // Roll back the partially created tree (cascades to children).
    await supabase.from("folders").delete().eq("id", root.id).eq("owner_id", user.id);
    throw err;
  }

  // Also map the client's raw spellings (e.g. with backslashes) to the same ids.
  for (const raw of rawPaths) {
    const key = splitPath(raw).join("/");
    if (folderIds[key]) folderIds[raw] = folderIds[key];
  }

  const res: CreateFolderTreeResponse = { rootId: root.id, folderIds };
  return NextResponse.json(res);
});

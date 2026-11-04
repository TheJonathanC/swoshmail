/** Folder name validation and tree helpers (server). */
import { badRequest } from "@/lib/http";
import { MAX_FOLDER_NAME_LENGTH } from "@/lib/constants";
import { sanitizeFileName } from "@/lib/files";
import { supabase } from "@/lib/supabase";
import { check } from "@/lib/http";

export function validateFolderName(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw badRequest("Folder name is required.");
  const name = sanitizeFileName(input, "");
  if (!name) throw badRequest("Folder name is invalid.");
  if (name.length > MAX_FOLDER_NAME_LENGTH) throw badRequest("Folder name is too long.");
  return name;
}

export interface TreeFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface TreeFile {
  id: string;
  name: string;
  size: number;
  key: string;
  folder_id: string;
}

export interface FolderTree {
  folders: TreeFolder[];
  files: TreeFile[];
}

/** All descendant folders (including the root) and their files in one RPC; null if not owned. */
export async function getFolderTree(folderId: string, ownerId: string): Promise<FolderTree | null> {
  const data = check(
    await supabase.rpc("folder_tree_contents", { p_folder_id: folderId, p_owner_id: ownerId }),
    "folder_tree_contents"
  ) as { folders?: TreeFolder[]; files?: (Omit<TreeFile, "size"> & { size: number | string })[] } | null;
  if (!data) return null;
  return {
    folders: data.folders ?? [],
    files: (data.files ?? []).map((f) => ({ ...f, size: Number(f.size) || 0 })),
  };
}

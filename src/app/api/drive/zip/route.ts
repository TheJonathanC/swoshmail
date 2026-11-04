import JSZip from "jszip";
import { Readable } from "node:stream";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, isUuid, notFound, readJson, requireUuid, route, tooLarge } from "@/lib/http";
import { getFolderTree } from "@/lib/folders";
import { getObjectNodeStream, headObject } from "@/lib/r2";
import { contentDisposition, getExtension, sanitizeZipSegment, uniqueZipPath } from "@/lib/files";
import { MAX_ZIP_BYTES, MAX_ZIP_FILES } from "@/lib/constants";

/** Formats that are already compressed: stored as-is to save CPU. */
const STORED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "mp3", "mp4", "m4a", "mov", "webm", "mkv", "avi",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst", "pdf", "docx", "xlsx", "pptx", "odt", "epub", "woff", "woff2",
]);

interface ZipEntry {
  path: string;
  key: string;
  name: string;
  size: number;
}

/**
 * A Readable that only opens the storage object when the zip writer first reads from
 * it. JSZip consumes entries sequentially, so at most one object stream is open at a
 * time and nothing is buffered in full.
 */
class LazyObjectStream extends Readable {
  private source: Readable | null = null;
  private opening = false;

  constructor(private readonly key: string) {
    super();
  }

  _read(): void {
    if (this.source) {
      this.source.resume();
      return;
    }
    if (this.opening) return;
    this.opening = true;
    getObjectNodeStream(this.key)
      .then((src) => {
        this.source = src;
        src.on("data", (chunk: Buffer) => {
          if (!this.push(chunk)) src.pause();
        });
        src.on("end", () => this.push(null));
        src.on("error", (err) => this.destroy(err));
      })
      .catch((err) => this.destroy(err));
  }

  _destroy(err: Error | null, cb: (error?: Error | null) => void): void {
    this.source?.destroy();
    cb(err);
  }
}

/** HEADs objects with bounded concurrency; returns the set of keys that are missing. */
async function findMissing(keys: string[], concurrency = 24): Promise<Set<string>> {
  const missing = new Set<string>();
  let i = 0;
  async function worker() {
    while (i < keys.length) {
      const key = keys[i++];
      try {
        if (!(await headObject(key))) missing.add(key);
      } catch (err) {
        console.error(`[zip] HEAD failed for ${key}:`, err);
        missing.add(key);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  return missing;
}

async function buildZip(entries: ZipEntry[], emptyDirs: string[], archiveName: string): Promise<Response> {
  if (entries.length > MAX_ZIP_FILES) throw tooLarge(`A ZIP can contain at most ${MAX_ZIP_FILES} files.`, "zip_too_large");
  const total = entries.reduce((s, e) => s + e.size, 0);
  if (total > MAX_ZIP_BYTES) throw tooLarge("A ZIP can be at most 2 GB. Select fewer files.", "zip_too_large");

  const missing = await findMissing(entries.map((e) => e.key));
  const zip = new JSZip();
  for (const dir of emptyDirs) zip.folder(dir);
  const missingPaths: string[] = [];
  for (const entry of entries) {
    if (missing.has(entry.key)) {
      missingPaths.push(entry.path);
      continue;
    }
    const stored = STORED_EXTENSIONS.has(getExtension(entry.name));
    zip.file(entry.path, new LazyObjectStream(entry.key), {
      binary: true,
      compression: stored ? "STORE" : "DEFLATE",
      compressionOptions: stored ? undefined : { level: 5 },
    });
  }
  if (missingPaths.length > 0) {
    const used = new Set(entries.map((e) => e.path.toLowerCase()));
    const listName = uniqueZipPath("_MISSING_FILES.txt", used);
    zip.file(
      listName,
      `The following files could not be read from Swosh Drive and were not included:\r\n\r\n${missingPaths.join("\r\n")}\r\n`
    );
  }

  const nodeStream = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, platform: "UNIX" }) as unknown as Readable;
  nodeStream.on("error", (err) => console.error("[zip] stream failed:", err));
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition("attachment", archiveName),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
}

async function zipFolder(userId: string, folderId: string): Promise<Response> {
  const tree = await getFolderTree(folderId, userId);
  if (!tree) throw notFound("Folder not found.", "folder_not_found");
  if (tree.files.length > MAX_ZIP_FILES) throw tooLarge(`A ZIP can contain at most ${MAX_ZIP_FILES} files.`, "zip_too_large");

  const root = tree.folders.find((f) => f.id === folderId)!;
  const used = new Set<string>();
  const pathOf = new Map<string, string>([[folderId, ""]]);
  // RPC returns folders ordered by depth, so parents are resolved before children.
  for (const f of tree.folders) {
    if (f.id === folderId) continue;
    const parentPath = pathOf.get(f.parent_id ?? "") ?? "";
    const candidate = (parentPath ? `${parentPath}/` : "") + sanitizeZipSegment(f.name, "folder");
    pathOf.set(f.id, uniqueZipPath(candidate, used));
  }

  const entries: ZipEntry[] = tree.files.map((file) => {
    const dir = pathOf.get(file.folder_id) ?? "";
    const candidate = (dir ? `${dir}/` : "") + sanitizeZipSegment(file.name, "file");
    return { path: uniqueZipPath(candidate, used), key: file.key, name: file.name, size: file.size };
  });

  const dirsWithFiles = new Set<string>();
  for (const file of tree.files) {
    let p = pathOf.get(file.folder_id) ?? "";
    while (p) {
      dirsWithFiles.add(p);
      p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    }
  }
  const emptyDirs = Array.from(pathOf.values()).filter((p) => p && !dirsWithFiles.has(p));

  return buildZip(entries, emptyDirs, `${sanitizeZipSegment(root.name, "folder")}.zip`);
}

async function zipFiles(userId: string, fileIds: string[]): Promise<Response> {
  if (fileIds.length === 0) throw badRequest("No files selected.");
  if (fileIds.length > MAX_ZIP_FILES) throw tooLarge(`A ZIP can contain at most ${MAX_ZIP_FILES} files.`, "zip_too_large");
  const rows: { id: string; name: string; key: string; size: number | string }[] = [];
  for (let i = 0; i < fileIds.length; i += 200) {
    const chunk = check(
      await supabase.from("files").select("id, name, key, size").eq("owner_id", userId).in("id", fileIds.slice(i, i + 200)),
      "zip files lookup"
    ) as typeof rows;
    rows.push(...(chunk ?? []));
  }
  if (rows.length === 0) throw notFound("Files not found.");
  const used = new Set<string>();
  const entries = rows.map((r) => ({
    path: uniqueZipPath(sanitizeZipSegment(r.name, "file"), used),
    key: r.key,
    name: r.name,
    size: Number(r.size) || 0,
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  const archive = rows.length === 1 ? `${sanitizeZipSegment(rows[0].name.replace(/\.[^.]+$/, ""), "file")}.zip` : `swosh-drive-${stamp}.zip`;
  return buildZip(entries, [], archive);
}

function parseIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const ids = list.map((s) => (typeof s === "string" ? s.trim() : s)).filter((s) => s !== "");
  if (!ids.every(isUuid)) throw badRequest("Invalid file id.");
  return Array.from(new Set((ids as string[]).map((s) => s.toLowerCase())));
}

/** Max ids accepted via the GET query string (keeps the URL well under server header limits). */
const MAX_QUERY_FILE_IDS = 300;

function assertWithinLimits(files: number, bytes: number) {
  if (files > MAX_ZIP_FILES) throw tooLarge(`A ZIP can contain at most ${MAX_ZIP_FILES} files.`, "zip_too_large");
  if (bytes > MAX_ZIP_BYTES) throw tooLarge("A ZIP can be at most 2 GB. Select fewer files.", "zip_too_large");
}

/**
 * Preflight used by the client before it navigates to the streaming GET, so limit
 * errors surface as toasts instead of being "downloaded" as a JSON file.
 */
async function preflight(userId: string, folderId: unknown, fileIds: unknown): Promise<Response> {
  await enforceRateLimit(`drive_zip_check_${userId}`, 30, MINUTE);
  if (folderId) {
    const tree = await getFolderTree(requireUuid(folderId, "folderId"), userId);
    if (!tree) throw notFound("Folder not found.", "folder_not_found");
    const bytes = tree.files.reduce((s, f) => s + (Number(f.size) || 0), 0);
    assertWithinLimits(tree.files.length, bytes);
    return Response.json({ ok: true, files: tree.files.length, bytes });
  }
  const ids = parseIds(fileIds);
  if (ids.length === 0) throw badRequest("No files selected.");
  if (ids.length > MAX_QUERY_FILE_IDS) {
    throw tooLarge(`You can ZIP at most ${MAX_QUERY_FILE_IDS} selected files at once. Download the folder instead.`, "zip_too_large");
  }
  let files = 0;
  let bytes = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const rows = check(
      await supabase.from("files").select("size").eq("owner_id", userId).in("id", ids.slice(i, i + 200)),
      "zip preflight lookup"
    ) as { size: number | string }[] | null;
    for (const r of rows ?? []) {
      files++;
      bytes += Number(r.size) || 0;
    }
  }
  if (files === 0) throw notFound("Files not found.");
  assertWithinLimits(files, bytes);
  return Response.json({ ok: true, files, bytes });
}

async function handle(userId: string, folderId: unknown, fileIds: unknown): Promise<Response> {
  await enforceRateLimit(`drive_zip_${userId}`, 10, MINUTE, "Too many ZIP downloads. Please wait a moment.");
  if (folderId) return zipFolder(userId, requireUuid(folderId, "folderId"));
  if (fileIds) return zipFiles(userId, parseIds(fileIds));
  throw badRequest("Provide folderId or fileIds.");
}

// GET /api/drive/zip?fileIds=a,b,c  or  ?folderId=<uuid>
export const GET = route("GET /api/drive/zip", async (request: Request) => {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  return handle(user.id, params.get("folderId"), params.get("fileIds"));
});

// POST /api/drive/zip { folderId?, fileIds?, check? } — check:true validates limits and returns JSON
export const POST = route("POST /api/drive/zip", async (request: Request) => {
  const user = await requireUser();
  const body = await readJson<{ folderId: string; fileIds: string[]; check?: boolean }>(request);
  if (body.check) return preflight(user.id, body.folderId, body.fileIds);
  return handle(user.id, body.folderId, body.fileIds);
});

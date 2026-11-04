/**
 * Turns folder selections (<input webkitdirectory>) and drag-and-drop payloads into
 * bundles that keep each file's directory path relative to the dropped folder.
 */

export interface FolderBundleEntry {
  file: File;
  /** Directory below the bundle root, "" for files directly inside it (e.g. "src/components"). */
  dir: string;
}

export interface FolderBundle {
  rootName: string;
  entries: FolderBundleEntry[];
}

export interface DropPayload {
  files: File[];
  folders: FolderBundle[];
}

function splitRelative(path: string): { root: string; dir: string } {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return { root: "", dir: "" };
  return { root: parts[0], dir: parts.slice(1, -1).join("/") };
}

/** Group files from a webkitdirectory input by their top-level folder. */
export function bundlesFromInput(files: File[]): DropPayload {
  const byRoot = new Map<string, FolderBundleEntry[]>();
  const loose: File[] = [];
  for (const file of files) {
    const { root, dir } = splitRelative(file.webkitRelativePath || "");
    if (!root) {
      loose.push(file);
      continue;
    }
    const list = byRoot.get(root) ?? [];
    list.push({ file, dir });
    byRoot.set(root, list);
  }
  return { files: loose, folders: [...byRoot].map(([rootName, entries]) => ({ rootName, entries })) };
}

/** Every directory path (and its ancestors) needed for a bundle, parents first. */
export function bundleDirectories(bundle: FolderBundle): string[] {
  const dirs = new Set<string>();
  for (const { dir } of bundle.entries) {
    if (!dir) continue;
    const parts = dir.split("/");
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return [...dirs].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkDirectory(dir: FileSystemDirectoryEntry, relDir: string, out: FolderBundleEntry[]) {
  const children = await readAllEntries(dir.createReader());
  for (const child of children) {
    if (child.isFile) {
      try {
        out.push({ file: await entryFile(child as FileSystemFileEntry), dir: relDir });
      } catch {
        /* unreadable file (permissions): skip */
      }
    } else if (child.isDirectory) {
      await walkDirectory(child as FileSystemDirectoryEntry, relDir ? `${relDir}/${child.name}` : child.name, out);
    }
  }
}

/**
 * Must be called synchronously from the drop handler: DataTransfer items are only
 * readable during the event, so entries are captured before any await.
 */
export function readDrop(dataTransfer: DataTransfer): Promise<DropPayload> {
  const entries: FileSystemEntry[] = [];
  const plainFiles: File[] = [];
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) plainFiles.push(file);
    }
  }
  if (entries.length === 0 && plainFiles.length === 0) {
    return Promise.resolve({ files: Array.from(dataTransfer.files ?? []), folders: [] });
  }
  const fallbackFiles = Array.from(dataTransfer.files ?? []);

  return (async () => {
    const payload: DropPayload = { files: [...plainFiles], folders: [] };
    for (const entry of entries) {
      if (entry.isDirectory) {
        const bundle: FolderBundle = { rootName: entry.name, entries: [] };
        try {
          await walkDirectory(entry as FileSystemDirectoryEntry, "", bundle.entries);
        } catch {
          /* ignore unreadable directories */
        }
        if (bundle.entries.length > 0) payload.folders.push(bundle);
      } else if (entry.isFile) {
        try {
          payload.files.push(await entryFile(entry as FileSystemFileEntry));
        } catch {
          const match = fallbackFiles.find((f) => f.name === entry.name);
          if (match) payload.files.push(match);
        }
      }
    }
    return payload;
  })();
}

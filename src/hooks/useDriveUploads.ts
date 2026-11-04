"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriveListResponse, FileItem } from "@/types/api";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError, errorMessage, isAbortError } from "@/lib/client/api";
import { formatBytes, nextAvailableName, pluralize } from "@/lib/client/files";
import { uploadFileToDrive } from "@/lib/client/upload";

export interface UploadEntry {
  file: File;
  /** Target folder id, or null for the Drive root. */
  folderId: string | null;
}

export type ConflictChoice = "replace" | "keep-both" | "skip" | "cancel-all";

export interface ConflictPrompt {
  fileName: string;
  existing: FileItem;
  newSize: number;
  keepBothName: string;
  /** Files still waiting after this one. */
  remaining: number;
}

export interface UploadProgress {
  total: number;
  done: number;
  currentName: string;
  /** 0..1 for the current file */
  fraction: number;
}

interface QueueItem extends UploadEntry {
  id: number;
}

interface Options {
  /** Folder currently shown ("root" or uuid). */
  currentFolderId: string;
  /** Files of the listing currently shown, used to seed duplicate detection. */
  currentFiles: readonly FileItem[] | null;
  mutateListing: (updater: (data: DriveListResponse) => DriveListResponse) => void;
  reloadListing: () => void;
  used: number;
  quota: number;
  onStorageChange: (used: number) => void;
}

const folderKey = (id: string | null) => id ?? "root";

/**
 * Sequential upload queue. Running totals (bytes used, names already taken in each
 * folder) live in refs so later files in a batch see the effect of earlier ones.
 * Files dropped while a batch runs are appended to the same queue.
 */
export function useDriveUploads(options: Options) {
  const toast = useToast();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [conflict, setConflict] = useState<ConflictPrompt | null>(null);

  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const queueRef = useRef<QueueItem[]>([]);
  const nextIdRef = useRef(1);
  const runningRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const knownRef = useRef(new Map<string, Map<string, FileItem>>());
  const usedRef = useRef(0);
  const resolverRef = useRef<((choice: ConflictChoice) => void) | null>(null);

  const knownFor = (key: string) => {
    let map = knownRef.current.get(key);
    if (!map) {
      map = new Map();
      knownRef.current.set(key, map);
    }
    return map;
  };

  const askConflict = (prompt: ConflictPrompt) =>
    new Promise<ConflictChoice>((resolve) => {
      resolverRef.current = resolve;
      setConflict(prompt);
    });

  const resolveConflict = useCallback((choice: ConflictChoice) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConflict(null);
    resolve?.(choice);
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    usedRef.current = optsRef.current.used;

    const uploaded: string[] = [];
    const failed: { name: string; message: string }[] = [];
    let quotaSkipped = 0;
    let cancelled = false;

    while (queueRef.current.length > 0) {
      if (controller.signal.aborted) {
        cancelled = true;
        break;
      }
      const item = queueRef.current.shift()!;
      const key = folderKey(item.folderId);
      const known = knownFor(key);
      setProgress((p) => ({ total: p?.total ?? 1, done: p?.done ?? 0, currentName: item.file.name, fraction: 0 }));

      let name = item.file.name;
      let replaceFileId: string | null = null;
      let replacedSize = 0;
      const existing = known.get(name);
      if (existing) {
        const choice = await askConflict({
          fileName: name,
          existing,
          newSize: item.file.size,
          keepBothName: nextAvailableName(name, (c) => known.has(c)),
          remaining: queueRef.current.length,
        });
        if (choice === "cancel-all" || controller.signal.aborted) {
          cancelled = true;
          break;
        }
        if (choice === "skip") {
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          continue;
        }
        if (choice === "replace") {
          replaceFileId = existing.id;
          replacedSize = existing.size;
        } else {
          name = nextAvailableName(name, (c) => known.has(c));
        }
      }

      const { quota } = optsRef.current;
      if (quota > 0 && usedRef.current - replacedSize + item.file.size > quota) {
        quotaSkipped += 1;
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        continue;
      }

      try {
        const result = await uploadFileToDrive(item.file, {
          folderId: item.folderId,
          name,
          replaceFileId,
          signal: controller.signal,
          onProgress: (fraction) => setProgress((p) => (p ? { ...p, fraction } : p)),
        });
        const file: FileItem = { ...result.file, size: Number(result.file.size) || item.file.size };
        usedRef.current = Number.isFinite(result.totalUsed) ? result.totalUsed : usedRef.current + file.size - replacedSize;
        optsRef.current.onStorageChange(usedRef.current);
        known.set(file.name, file);
        uploaded.push(file.name);

        // Optimistic insert only when the user is still looking at the target folder
        if (folderKey(file.folder_id) === optsRef.current.currentFolderId) {
          optsRef.current.mutateListing((data) => ({
            ...data,
            totalUsed: usedRef.current,
            files: replaceFileId
              ? data.files.map((f) => (f.id === replaceFileId || f.id === file.id ? file : f))
              : [file, ...data.files.filter((f) => f.id !== file.id)],
          }));
        }
      } catch (err) {
        if (isAbortError(err)) {
          cancelled = true;
          break;
        }
        if (err instanceof ApiRequestError && (err.code === "quota_exceeded" || err.status === 413)) {
          quotaSkipped += 1;
        } else {
          failed.push({ name, message: errorMessage(err, `Couldn't upload ${name}.`) });
        }
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1, fraction: 0 } : p));
    }

    // Reset the batch
    const leftover = queueRef.current.length;
    queueRef.current = [];
    knownRef.current = new Map();
    runningRef.current = false;
    controllerRef.current = null;
    setProgress(null);
    if (resolverRef.current) resolveConflict("cancel-all");
    optsRef.current.reloadListing();

    if (uploaded.length === 1 && !cancelled) toast("success", "Uploaded", `${uploaded[0]} was saved to your Drive.`);
    else if (uploaded.length > 1) toast("success", "Upload complete", `${pluralize(uploaded.length, "file")} saved to your Drive.`);
    if (cancelled) {
      const skipped = leftover + (uploaded.length === 0 ? 1 : 0);
      toast("info", "Upload cancelled", skipped > 0 ? `${pluralize(skipped, "file")} weren't uploaded.` : "Remaining uploads were cancelled.");
    }
    if (quotaSkipped > 0) {
      toast(
        "danger",
        "Not enough storage",
        `${pluralize(quotaSkipped, "file")} didn't fit in your ${formatBytes(optsRef.current.quota)} Drive. Delete some files and try again.`
      );
    }
    if (failed.length === 1) toast("danger", "Upload failed", `${failed[0].name}: ${failed[0].message}`);
    else if (failed.length > 1) toast("danger", "Some uploads failed", `${pluralize(failed.length, "file")} couldn't be uploaded, including ${failed[0].name}.`);
  }, [toast, resolveConflict]);

  /** Add files to the queue (starts it if idle). Duplicate detection is seeded from the current listing. */
  const enqueue = useCallback(
    (entries: UploadEntry[]) => {
      if (entries.length === 0) return;
      const { currentFolderId, currentFiles } = optsRef.current;
      for (const entry of entries) {
        const key = folderKey(entry.folderId);
        if (!knownRef.current.has(key)) {
          const map = knownFor(key);
          if (key === currentFolderId && currentFiles) currentFiles.forEach((f) => map.set(f.name, f));
        }
        queueRef.current.push({ ...entry, id: nextIdRef.current++ });
      }
      setProgress((p) => ({
        total: (p?.total ?? 0) + entries.length,
        done: p?.done ?? 0,
        currentName: p?.currentName ?? entries[0].file.name,
        fraction: p?.fraction ?? 0,
      }));
      void run();
    },
    [run]
  );

  /** Abort the current upload and drop everything still queued. */
  const cancel = useCallback(() => {
    queueRef.current = [];
    controllerRef.current?.abort();
    if (resolverRef.current) resolveConflict("cancel-all");
  }, [resolveConflict]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { enqueue, cancel, progress, isUploading: progress !== null, conflict, resolveConflict };
}

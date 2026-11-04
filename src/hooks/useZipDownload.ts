"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, postJson } from "@/lib/client/api";
import { triggerDownload, zipUrl } from "@/lib/client/download";
import { formatBytes, pluralize } from "@/lib/client/files";

interface ZipPreflight {
  ok: true;
  files: number;
  bytes: number;
}

/**
 * Validates limits with a JSON preflight (so errors become toasts), then streams the
 * archive through a plain anchor navigation (no in-memory blob).
 */
export function useZipDownload() {
  const toast = useToast();
  const [isPreparing, setIsPreparing] = useState(false);

  const run = useCallback(
    async (target: { fileIds: string[] } | { folderId: string }, label: string) => {
      setIsPreparing(true);
      try {
        const check = await postJson<ZipPreflight>("/api/drive/zip", { ...target, check: true });
        triggerDownload(zipUrl(target));
        toast("info", "Preparing ZIP", `${label} (${pluralize(check.files, "file")}, ${formatBytes(check.bytes)}) will start downloading shortly.`);
      } catch (err) {
        toast("danger", "Couldn't create ZIP", errorMessage(err));
      } finally {
        setIsPreparing(false);
      }
    },
    [toast]
  );

  const downloadFiles = useCallback(
    (fileIds: string[]) => {
      if (fileIds.length === 0) return;
      void run({ fileIds }, "Your download");
    },
    [run]
  );

  const downloadFolder = useCallback(
    (folderId: string, folderName: string) => {
      void run({ folderId }, `"${folderName}"`);
    },
    [run]
  );

  return { downloadFiles, downloadFolder, isPreparing };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import type { SharedFileInfo, TextPreviewResponse, TextSaveResponse } from "@/types/api";
import { errorMessage, getJson, isAbortError, postJson, withQuery } from "@/lib/client/api";

interface SharedState {
  token: string | null;
  info: SharedFileInfo | null;
  text: TextPreviewResponse | null;
  error: string | null;
}

/** Recipient side of a ?share= link: metadata, optional text preview and save-to-Drive. */
export function useSharedLink(token: string | null) {
  const [state, setState] = useState<SharedState>({ token: null, info: null, text: null, error: null });

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      try {
        const raw = await getJson<SharedFileInfo | { file: SharedFileInfo }>(
          withQuery("/api/drive/share", { token }),
          controller.signal
        );
        const info: SharedFileInfo = "file" in raw ? raw.file : raw;
        let text: TextPreviewResponse | null = null;
        if (info.previewKind === "text") {
          try {
            text = await getJson<TextPreviewResponse>(withQuery("/api/drive/share/preview", { token }), controller.signal);
          } catch (err) {
            if (isAbortError(err)) throw err;
            text = null; // preview is optional
          }
        }
        setState({ token, info: { ...info, size: Number(info.size) || 0 }, text, error: null });
      } catch (err) {
        if (isAbortError(err)) return;
        setState({ token, info: null, text: null, error: errorMessage(err, "This shared file is unavailable or the link has expired.") });
      }
    })();
    return () => controller.abort();
  }, [token]);

  const save = useCallback(
    (folderId: string) =>
      postJson<TextSaveResponse>("/api/drive/share/save", { token, folderId: folderId === "root" ? null : folderId }),
    [token]
  );

  const current = state.token === token;
  return {
    loading: Boolean(token) && !current,
    info: current ? state.info : null,
    text: current ? state.text : null,
    error: current ? state.error : null,
    save,
  };
}

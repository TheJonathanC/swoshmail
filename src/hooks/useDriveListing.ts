"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriveListResponse } from "@/types/api";
import { errorMessage, getJson, isAbortError, withQuery } from "@/lib/client/api";

interface ListingState {
  /** `${folderId}#${version}` the data/error belongs to. */
  key: string | null;
  folderId: string | null;
  data: DriveListResponse | null;
  error: string | null;
}

export interface DriveListing {
  data: DriveListResponse | null;
  /** True while the first load for this folder is in flight (stale data for another folder is hidden). */
  isLoading: boolean;
  /** True while a background refresh of the same folder is in flight. */
  isRefreshing: boolean;
  error: string | null;
  reload: () => void;
  /** Optimistically update the listing currently shown for `folderId`. */
  mutate: (updater: (data: DriveListResponse) => DriveListResponse) => void;
}

/**
 * Loads GET /api/drive for an explicit folder id. Each request is aborted when the
 * folder changes and results are applied only if they still match the latest request.
 */
export function useDriveListing(
  folderId: string,
  opts: { enabled?: boolean; refreshKey?: number; onLoaded?: (data: DriveListResponse) => void } = {}
): DriveListing {
  const { enabled = true, refreshKey = 0 } = opts;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<ListingState>({ key: null, folderId: null, data: null, error: null });
  const onLoadedRef = useRef(opts.onLoaded);
  const latestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    onLoadedRef.current = opts.onLoaded;
  });

  const key = `${folderId}#${version}#${refreshKey}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    latestKeyRef.current = key;
    getJson<DriveListResponse>(withQuery("/api/drive", { folderId }), controller.signal)
      .then((data) => {
        if (latestKeyRef.current !== key) return;
        const normalised: DriveListResponse = {
          files: (data.files ?? []).map((f) => ({ ...f, size: Number(f.size) || 0 })),
          folders: data.folders ?? [],
          breadcrumbs: data.breadcrumbs ?? [],
          totalUsed: Number(data.totalUsed) || 0,
          quota: Number(data.quota) || 0,
        };
        setState({ key, folderId, data: normalised, error: null });
        onLoadedRef.current?.(normalised);
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || latestKeyRef.current !== key) return;
        setState((prev) => ({
          key,
          folderId,
          data: prev.folderId === folderId ? prev.data : null,
          error: errorMessage(err, "Couldn't load this folder."),
        }));
      });
    return () => controller.abort();
  }, [enabled, folderId, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const mutate = useCallback(
    (updater: (data: DriveListResponse) => DriveListResponse) => {
      setState((prev) => (prev.folderId === folderId && prev.data ? { ...prev, data: updater(prev.data) } : prev));
    },
    [folderId]
  );

  const sameFolder = state.folderId === folderId;
  const settled = state.key === key;
  return {
    data: sameFolder ? state.data : null,
    isLoading: enabled && !settled && !(sameFolder && state.data),
    isRefreshing: enabled && !settled && sameFolder && Boolean(state.data),
    error: settled ? state.error : null,
    reload,
    mutate,
  };
}

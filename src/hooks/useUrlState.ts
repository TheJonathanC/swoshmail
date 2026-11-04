"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type WorkspaceTab = "mail" | "drive" | "chat";

export const TABS: readonly WorkspaceTab[] = ["mail", "drive", "chat"];

export interface UrlState {
  tab: WorkspaceTab;
  /** "root" or a folder uuid (Drive only). */
  folderId: string;
  /** Share token from a ?share= link, if any. */
  shareToken: string | null;
}

export interface NavigateInput {
  tab?: WorkspaceTab;
  folderId?: string;
  share?: string | null;
}

function parseTab(pathname: string | null, hasShare: boolean): WorkspaceTab {
  const segment = (pathname ?? "/").split("/").filter(Boolean)[0];
  if (segment === "drive" || segment === "chat" || segment === "mail") return segment;
  return hasShare ? "drive" : "mail";
}

export function buildWorkspaceUrl(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.tab === "drive" && state.folderId && state.folderId !== "root") params.set("folder", state.folderId);
  if (state.shareToken) params.set("share", state.shareToken);
  const qs = params.toString();
  return `/${state.tab}${qs ? `?${qs}` : ""}`;
}

/**
 * Workspace navigation state lives in the URL (/mail, /drive?folder=, /chat, ?share=).
 * Updates use the native History API, which Next.js syncs into usePathname/useSearchParams,
 * so Back/Forward work without any extra popstate wiring.
 */
export function useUrlState() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("share");
  const state: UrlState = {
    tab: parseTab(pathname, Boolean(shareToken)),
    folderId: searchParams.get("folder") || "root",
    shareToken,
  };

  const navigate = useCallback((next: NavigateInput, opts?: { replace?: boolean }) => {
    const current = new URL(window.location.href);
    const currentShare = current.searchParams.get("share");
    const currentTab = parseTab(current.pathname, Boolean(currentShare));
    const tab = next.tab ?? currentTab;
    const folderId =
      next.folderId ?? (tab === "drive" && currentTab === "drive" ? current.searchParams.get("folder") || "root" : "root");
    const share = next.share === undefined ? currentShare : next.share;
    const url = buildWorkspaceUrl({ tab, folderId, shareToken: share });
    if (url === `${current.pathname}${current.search}`) return;
    if (opts?.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, []);

  return { ...state, navigate };
}

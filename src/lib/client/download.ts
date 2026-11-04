/** Navigation-based downloads: the browser streams the response, nothing is buffered in memory. */
import { withQuery } from "./api";

export function triggerDownload(url: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export const fileDownloadUrl = (fileId: string) => withQuery("/api/drive/download", { fileId });
export const fileInlineUrl = (fileId: string) => withQuery("/api/drive/download", { fileId, inline: 1 });
export const sharedDownloadUrl = (token: string) => withQuery("/api/drive/share/download", { token });
export const sharedPreviewUrl = (token: string) => withQuery("/api/drive/share/preview", { token });

export function zipUrl(target: { fileIds: string[] } | { folderId: string }): string {
  return "fileIds" in target
    ? withQuery("/api/drive/zip", { fileIds: target.fileIds.join(",") })
    : withQuery("/api/drive/zip", { folderId: target.folderId });
}

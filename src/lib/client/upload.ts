/**
 * Drive upload pipeline (see src/types/api.ts):
 *   1. POST /api/drive/upload {action:"init"}  -> presigned PUT URL + headers
 *   2. PUT the bytes straight to storage via XHR (progress)
 *   3. POST /api/drive/upload {action:"complete"}
 * Falls back to a multipart POST /api/drive for small files when the direct PUT is
 * blocked (network / CORS) or the presigned endpoint is unavailable.
 */
import type { UploadCompleteResponse, UploadInitRequest, UploadInitResponse } from "@/types/api";
import { ApiRequestError, expectOk, isAbortError, postJson, xhrRequest } from "./api";
import { ONE_MB } from "./files";

export const MULTIPART_FALLBACK_MAX_BYTES = 4 * ONE_MB;

export interface DriveUploadOptions {
  /** Target folder id, or null for the Drive root. */
  folderId: string | null;
  /** Name to store the file under (defaults to file.name). */
  name?: string;
  replaceFileId?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

async function uploadMultipart(file: File, name: string, opts: DriveUploadOptions): Promise<UploadCompleteResponse> {
  const form = new FormData();
  form.append("file", name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified }));
  if (opts.folderId) form.append("folderId", opts.folderId);
  if (opts.replaceFileId) form.append("replaceFileId", opts.replaceFileId);
  const result = await xhrRequest({
    method: "POST",
    url: "/api/drive",
    body: form,
    signal: opts.signal,
    onProgress: (loaded, total) => opts.onProgress?.(total ? loaded / total : 0),
  });
  return expectOk<UploadCompleteResponse>(result, `Couldn't upload ${name}.`);
}

export async function uploadFileToDrive(file: File, opts: DriveUploadOptions): Promise<UploadCompleteResponse> {
  const name = opts.name ?? file.name;
  const canFallback = file.size <= MULTIPART_FALLBACK_MAX_BYTES;
  const type = file.type || "application/octet-stream";

  let init: UploadInitResponse;
  try {
    const request: UploadInitRequest = {
      action: "init",
      name,
      size: file.size,
      type,
      folderId: opts.folderId,
      replaceFileId: opts.replaceFileId ?? null,
    };
    init = await postJson<UploadInitResponse>("/api/drive/upload", request, opts.signal);
  } catch (err) {
    // Presigned uploads not available on this deployment: use the legacy route.
    if (canFallback && err instanceof ApiRequestError && (err.status === 404 || err.status === 405 || err.status === 501)) {
      return uploadMultipart(file, name, opts);
    }
    throw err;
  }

  try {
    const put = await xhrRequest({
      method: "PUT",
      url: init.uploadUrl,
      body: file,
      headers: init.headers,
      withCredentials: false,
      signal: opts.signal,
      onProgress: (loaded, total) => opts.onProgress?.(total ? loaded / total : 0),
    });
    if (put.status < 200 || put.status >= 300) {
      throw new ApiRequestError(`Couldn't upload ${name}. Please try again.`, put.status);
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (canFallback && err instanceof ApiRequestError && err.isNetworkError) {
      return uploadMultipart(file, name, opts);
    }
    throw err;
  }

  return postJson<UploadCompleteResponse>("/api/drive/upload", { action: "complete", uploadToken: init.uploadToken }, opts.signal);
}

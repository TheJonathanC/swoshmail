/**
 * Typed fetch / XHR helpers for client components.
 * All errors are normalised into ApiRequestError with a user-safe message.
 */
import type { ApiError } from "@/types/api";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }

  /** Network failure, CORS rejection or offline (no HTTP status). */
  get isNetworkError() {
    return this.status === 0;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Infrastructure details must never reach the UI copy.
const INFRA_PATTERN = /\b(r2|cloudflare|vercel|supabase|postgres|s3|aws|smtp|nodemailer|ECONN\w*)\b/i;

const CODE_MESSAGES: Record<string, string> = {
  quota_exceeded: "There isn't enough free space in your Drive for this file.",
  rate_limited: "You're doing that too often. Wait a moment and try again.",
  not_found: "That item no longer exists. It may have been moved or deleted.",
  invalid_input: "Some of the details weren't valid. Check them and try again.",
  maintenance: "Email sending is paused for maintenance. Try again later.",
  folder_not_found: "That folder doesn't exist anymore. It may have been deleted.",
  name_conflict: "A file with that name already exists in this folder. Choose another name.",
  not_editable: "This type of file can't be edited as a note.",
  share_unavailable: "This share link has expired or was revoked. Ask the sender for a new one.",
  user_not_found: "There's no Swosh user with that username.",
  self_share: "You can't share a file with yourself.",
  too_large: "That file is too large.",
  zip_too_large: "That selection is too large to download as one ZIP. Select fewer files.",
  invalid_recipient: "One of the recipient addresses isn't valid.",
  send_failed: "The email couldn't be delivered. Try again in a moment.",
  upload_missing: "The upload didn't finish. Please try again.",
  invalid_token: "The upload expired. Please try again.",
  unauthorized: "Your session has expired. Sign in again to continue.",
};

const STATUS_MESSAGES: Record<number, string> = {
  401: "Your session has expired. Sign in again to continue.",
  403: "You don't have access to that item.",
  404: CODE_MESSAGES.not_found,
  409: "An item with that name already exists here.",
  413: "That's too large to upload.",
  429: CODE_MESSAGES.rate_limited,
};

export function friendlyMessage(status: number, body?: Partial<ApiError> | null, fallback?: string): string {
  if (body?.code && CODE_MESSAGES[body.code]) return CODE_MESSAGES[body.code];
  const raw = typeof body?.error === "string" ? body.error.trim() : "";
  if (raw && raw.length < 200 && !INFRA_PATTERN.test(raw)) return raw;
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status === 0) return "Couldn't reach Swosh Workspace. Check your connection and try again.";
  return fallback ?? "Something went wrong. Please try again.";
}

/** Message to show for any thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof TypeError) return friendlyMessage(0);
  return fallback;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiRequestError(friendlyMessage(0), 0);
  }
  const body = await parseBody(res);
  if (!res.ok) {
    const errBody = (body && typeof body === "object" ? body : null) as Partial<ApiError> | null;
    throw new ApiRequestError(friendlyMessage(res.status, errBody), res.status, errBody?.code);
  }
  return body as T;
}

export function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return apiFetch<T>(url, { signal });
}

export function sendJson<T>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", data: unknown, signal?: AbortSignal) {
  return apiFetch<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal,
  });
}

export const postJson = <T>(url: string, data: unknown, signal?: AbortSignal) => sendJson<T>(url, "POST", data, signal);

export function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface XhrOptions {
  method: "POST" | "PUT";
  url: string;
  body: XMLHttpRequestBodyInit;
  headers?: Record<string, string>;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  /** Send cookies (same-origin API). Presigned storage URLs must not. */
  withCredentials?: boolean;
}

export interface XhrResult {
  status: number;
  body: unknown;
}

/** XHR wrapper with upload progress and AbortSignal support. Rejects only on network errors / abort. */
export function xhrRequest({ method, url, body, headers, onProgress, signal, withCredentials }: XhrOptions): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (withCredentials !== undefined) xhr.withCredentials = withCredentials;
    for (const [name, value] of Object.entries(headers ?? {})) xhr.setRequestHeader(name, value);

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
    }
    xhr.onload = () => {
      cleanup();
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = null;
      }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ApiRequestError(friendlyMessage(0), 0));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    xhr.send(body);
  });
}

/** Throw ApiRequestError for non-2xx XHR results, otherwise return the typed body. */
export function expectOk<T>(result: XhrResult, fallback?: string): T {
  if (result.status >= 200 && result.status < 300) return result.body as T;
  const errBody = (result.body && typeof result.body === "object" ? result.body : null) as Partial<ApiError> | null;
  throw new ApiRequestError(friendlyMessage(result.status, errBody, fallback), result.status, errBody?.code);
}

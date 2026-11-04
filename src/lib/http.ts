import { NextResponse } from "next/server";
import type { ApiError } from "@/types/api";

/**
 * Error with a user-safe message. Anything else thrown inside a route handler is
 * logged server-side and turned into a generic 500, so raw driver/vendor messages
 * (storage endpoints, SQL, SMTP transcripts) never reach the client.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly publicMessage: string;
  readonly headers?: Record<string, string>;

  constructor(status: number, publicMessage: string, code?: string, headers?: Record<string, string>) {
    super(publicMessage);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.headers = headers;
  }
}

export const badRequest = (message = "Invalid request.", code = "invalid_input") =>
  new HttpError(400, message, code);
export const notFound = (message = "Not found.", code = "not_found") => new HttpError(404, message, code);
export const forbidden = (message = "Access denied.", code = "forbidden") => new HttpError(403, message, code);
export const conflict = (message = "Conflict.", code = "conflict") => new HttpError(409, message, code);
export const tooLarge = (message = "Payload too large.", code = "too_large") => new HttpError(413, message, code);

export function jsonError(
  status: number,
  message: string,
  code?: string,
  headers?: Record<string, string>
): NextResponse<ApiError> {
  const body: ApiError = code ? { error: message, code } : { error: message };
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Logs the real error server-side and returns a generic message. */
export function serverError(context: string, err: unknown, message = "Something went wrong. Please try again."): NextResponse<ApiError> {
  console.error(`[api] ${context}:`, err);
  return jsonError(500, message, "server_error");
}

export function toErrorResponse(context: string, err: unknown): Response {
  if (err instanceof HttpError) {
    return jsonError(err.status, err.publicMessage, err.code, err.headers);
  }
  return serverError(context, err);
}

type Handler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

/** Wraps a route handler so HttpErrors map to JSON and everything else becomes a logged 500. */
export function route<Args extends unknown[]>(context: string, handler: Handler<Args>): Handler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(context, err);
    }
  };
}

/** Parses a JSON object body; malformed or non-object bodies become 400. */
export async function readJson<T extends object = Record<string, unknown>>(request: Request, maxBytes = 1024 * 1024): Promise<Partial<T>> {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > maxBytes) throw tooLarge("Request body is too large.");
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw badRequest("Could not read request body.");
  }
  if (text.length > maxBytes * 4) throw tooLarge("Request body is too large.");
  if (!text.trim()) throw badRequest("Request body must be JSON.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Request body must be a JSON object.");
  }
  return parsed as Partial<T>;
}

/** Parses multipart/urlencoded form data; failures become 400. */
export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw badRequest("Request body must be multipart form data.");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw badRequest(`Invalid ${field}.`);
  return value.toLowerCase();
}

/** Accepts null/undefined/""/"root" as the drive root, otherwise requires a UUID. */
export function parseFolderId(value: unknown, field = "folderId"): string | null {
  if (value === null || value === undefined || value === "" || value === "root") return null;
  return requireUuid(value, field);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Supabase/PostgREST error shape (subset). */
export interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

export function isQuotaViolation(err: DbError | null | undefined): boolean {
  if (!err) return false;
  return err.code === "23514" && /quota_exceeded|storage_used/i.test(`${err.message ?? ""} ${err.details ?? ""}`);
}

export function isUniqueViolation(err: DbError | null | undefined): boolean {
  return !!err && err.code === "23505";
}

export function isForeignKeyViolation(err: DbError | null | undefined): boolean {
  return !!err && err.code === "23503";
}

export const quotaExceeded = () =>
  new HttpError(413, "Storage quota exceeded. Your Swosh Drive limit is 1 GB.", "quota_exceeded");

/** Throws a logged 500 if a Supabase call returned an error. */
export function check<T>(result: { data: T; error: DbError | null }, context: string): T {
  if (result.error) {
    if (isQuotaViolation(result.error)) throw quotaExceeded();
    console.error(`[db] ${context}:`, result.error);
    throw new HttpError(500, "Something went wrong. Please try again.", "server_error");
  }
  return result.data;
}

/** Best-effort client IP (first hop of x-forwarded-for, then x-real-ip). */
export function clientIp(headers: Headers | Record<string, string | string[] | undefined> | undefined): string {
  if (!headers) return "unknown";
  const get = (name: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(name) ?? undefined;
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const xff = get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return get("x-real-ip")?.trim() || "unknown";
}

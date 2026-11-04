import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, short-lived token that carries the server's decisions from the upload
 * "init" step to "complete" (object key, display name, folder, replace target),
 * so the client cannot redirect a completed upload to another key or user.
 */
export interface UploadTokenPayload {
  /** user id */
  u: string;
  /** object key */
  k: string;
  /** sanitized display name */
  n: string;
  /** folder id or null */
  f: string | null;
  /** file id being replaced, or null */
  r: string | null;
  /** content type (informational, stored in files.content_type) */
  t: string;
  /** declared size */
  s: number;
  /** expiry, epoch seconds */
  e: number;
}

function getSecret(secret?: string): string {
  const s = secret ?? process.env.NEXTAUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("NEXTAUTH_SECRET is not configured (required to sign upload tokens).");
  }
  return s;
}

function mac(data: string, secret: string): string {
  return createHmac("sha256", `swosh-upload:${secret}`).update(data).digest("base64url");
}

export function signUploadToken(payload: UploadTokenPayload, secret?: string): string {
  const key = getSecret(secret);
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${body}.${mac(body, key)}`;
}

/** Returns the payload, or null if malformed, tampered or expired. */
export function verifyUploadToken(token: unknown, secret?: string, nowSeconds = Math.floor(Date.now() / 1000)): UploadTokenPayload | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const key = getSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = mac(body, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as UploadTokenPayload;
    if (typeof data.u !== "string" || typeof data.k !== "string" || typeof data.n !== "string") return null;
    if (typeof data.e !== "number" || data.e < nowSeconds) return null;
    return data;
  } catch {
    return null;
  }
}

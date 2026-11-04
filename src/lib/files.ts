/**
 * Pure helpers for file names and file-serving headers (no I/O, unit tested).
 */
import {
  INLINE_EXTENSIONS,
  INLINE_IMAGE_EXTENSIONS,
  MAX_FILE_NAME_LENGTH,
  MIME_BY_EXTENSION,
  TEXT_PREVIEW_EXTENSIONS,
} from "@/lib/constants";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Makes a user-supplied name safe to store and to use as a display/zip entry name:
 * strips path separators and control/bidi characters, removes ".." sequences and
 * leading dots, collapses whitespace and caps the length at 255 (keeping the extension).
 * Returns `fallback` when nothing usable is left.
 */
export function sanitizeFileName(input: unknown, fallback = "untitled"): string {
  if (typeof input !== "string") return fallback;
  let name = input.normalize("NFC").replace(CONTROL_CHARS, "");
  name = name.replace(/[/\\]/g, "_");
  name = name.replace(/[<>:"|?*]/g, "_");
  while (name.includes("..")) name = name.replace(/\.\.+/g, ".");
  name = name.replace(/\s+/g, " ").trim();
  name = name.replace(/^[.\s]+/, "");
  name = name.replace(/[.\s]+$/, "");
  if (!name) return fallback;
  if (name.length > MAX_FILE_NAME_LENGTH) {
    const { base, ext } = splitName(name);
    const keepExt = ext && ext.length < 32 ? ext : "";
    name = base.slice(0, MAX_FILE_NAME_LENGTH - keepExt.length).trimEnd() + keepExt;
    if (name.length > MAX_FILE_NAME_LENGTH) name = name.slice(0, MAX_FILE_NAME_LENGTH);
  }
  return name || fallback;
}

/** Splits "a.tar.gz" into { base: "a.tar", ext: ".gz" }; dotfiles have no extension. */
export function splitName(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return { base: name, ext: "" };
  return { base: name.slice(0, idx), ext: name.slice(idx) };
}

export function getExtension(name: string): string {
  const { ext } = splitName(name);
  return ext ? ext.slice(1).toLowerCase() : "";
}

/** Returns `name`, or "name (1).ext", "name (2).ext", ... avoiding names in `taken` (case-insensitive). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const lower = new Set<string>();
  for (const t of taken) lower.add(t.toLowerCase());
  if (!lower.has(name.toLowerCase())) return name;
  const { base, ext } = splitName(name);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** Content-Type derived from the extension only. */
export function mimeForName(name: string): string {
  const ext = getExtension(name);
  if (MIME_BY_EXTENSION[ext]) return MIME_BY_EXTENSION[ext];
  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function canServeInline(name: string): boolean {
  return INLINE_EXTENSIONS.has(getExtension(name));
}

export function previewKindFor(name: string): "image" | "text" | "pdf" | "none" {
  const ext = getExtension(name);
  if (INLINE_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) return "text";
  return "none";
}

function asciiFallback(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/[\r\n]/g, "");
  return ascii.trim() || "download";
}

/** RFC 6266 / RFC 5987 Content-Disposition with an ASCII fallback and UTF-8 filename*. */
export function contentDisposition(type: "inline" | "attachment", name: string): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${asciiFallback(name)}"; filename*=UTF-8''${encoded}`;
}

export interface FileHeaderOptions {
  name: string;
  /** Requested inline display; only honored for allowlisted raster images and pdf. */
  inline?: boolean;
  /** Byte length from storage (preferred) or DB. */
  contentLength?: number | null;
}

/**
 * Safe headers for serving user files from the app origin. Content-Type is derived
 * from the extension (never from upload metadata); anything not allowlisted is
 * forced to download and the response is sandboxed.
 */
export function fileResponseHeaders({ name, inline = false, contentLength }: FileHeaderOptions): Headers {
  const allowInline = inline && canServeInline(name);
  const headers = new Headers();
  // mimeForName never yields an active type (html/svg/xml map to text/plain or octet-stream).
  headers.set("Content-Type", mimeForName(name));
  headers.set("Content-Disposition", contentDisposition(allowInline ? "inline" : "attachment", name));
  headers.set("X-Content-Type-Options", "nosniff");
  // Inline PDFs cannot use `sandbox` (Chromium refuses to render PDFs in sandboxed
  // documents); the browser's PDF viewer runs document scripts isolated from our origin.
  const inlinePdf = allowInline && getExtension(name) === "pdf";
  headers.set(
    "Content-Security-Policy",
    inlinePdf ? "frame-ancestors 'self'" : "sandbox; default-src 'none'; frame-ancestors 'self'"
  );
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Cache-Control", "private, no-store");
  if (typeof contentLength === "number" && Number.isFinite(contentLength) && contentLength >= 0) {
    headers.set("Content-Length", String(contentLength));
  }
  return headers;
}

/** Makes a name safe as a single zip path segment. */
export function sanitizeZipSegment(name: string, fallback = "untitled"): string {
  return sanitizeFileName(name, fallback);
}

/** Returns a unique zip entry path (case-insensitive) and records it in `used`. */
export function uniqueZipPath(path: string, used: Set<string>): string {
  const lowerUsed = (p: string) => used.has(p.toLowerCase());
  if (!lowerUsed(path)) {
    used.add(path.toLowerCase());
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const { base, ext } = splitName(file);
  for (let i = 1; ; i++) {
    const candidate = `${dir}${base} (${i})${ext}`;
    if (!lowerUsed(candidate)) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

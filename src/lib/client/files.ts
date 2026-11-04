/**
 * Client-side file helpers: byte formatting, extension sets and naming.
 * This is the single source of truth for which files can be previewed or edited in the UI.
 */

export const ONE_MB = 1024 * 1024;
export const ONE_GB = 1024 * ONE_MB;

/** Raster images the server will serve inline (never SVG). */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);

/** Text-like files that can be previewed and edited as notes. */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt", "md", "log", "json", "css", "js", "ts", "jsx", "tsx", "html", "xml", "csv",
  "sql", "yaml", "yml", "env", "conf", "ini", "sh",
]);

export const PDF_EXTENSIONS: ReadonlySet<string> = new Set(["pdf"]);

export type PreviewKind = "image" | "text" | "pdf" | "none";

export function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

export function getPreviewKind(name: string): PreviewKind {
  const ext = getExtension(name);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  return "none";
}

export const isPreviewable = (name: string) => getPreviewKind(name) !== "none";
export const isEditable = (name: string) => TEXT_EXTENSIONS.has(getExtension(name));

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : parseFloat(value.toFixed(decimals))} ${units[i]}`;
}

export function sumSizes(items: ReadonlyArray<{ size: number }>): number {
  return items.reduce((acc, item) => acc + item.size, 0);
}

/** "report.pdf" -> "report (1).pdf", skipping names already taken (case-insensitive). */
export function nextAvailableName(name: string, taken: (candidate: string) => boolean): string {
  const { base, ext } = splitName(name);
  let counter = 1;
  let candidate = `${base} (${counter})${ext}`;
  while (taken(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

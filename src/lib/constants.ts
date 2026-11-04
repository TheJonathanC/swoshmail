/** Shared server constants. Safe to import from client code (no secrets). */

export const ONE_GB = 1024 * 1024 * 1024;
export const ONE_MB = 1024 * 1024;

/** Per-user drive quota, mirrored by the files trigger in supabase_setup.sql. */
export const DRIVE_QUOTA_BYTES = ONE_GB;

/** Largest single file accepted by the presigned upload flow. */
export const MAX_UPLOAD_BYTES = ONE_GB;
/** Legacy multipart POST /api/drive (serverless body limit is ~4.5 MB). */
export const MAX_MULTIPART_UPLOAD_BYTES = 4 * ONE_MB;
/** Text notes created/edited in the browser. */
export const MAX_TEXT_FILE_BYTES = ONE_MB;
/** Text previews. */
export const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;

export const MAX_ZIP_BYTES = 2 * ONE_GB;
export const MAX_ZIP_FILES = 2000;

export const MAX_FILE_NAME_LENGTH = 255;
export const MAX_FOLDER_NAME_LENGTH = 255;
export const MAX_FOLDER_TREE_PATHS = 1000;
export const MAX_BATCH_IDS = 1000;

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

// Mail
export const MAIL_MAX_RECIPIENTS = 5;
export const MAIL_MAX_SUBJECT = 255;
export const MAIL_MAX_BODY = 100_000;
export const MAIL_MAX_DIRECT_BYTES = 4 * ONE_MB;
export const MAIL_MAX_TOTAL_BYTES = 20 * ONE_MB;

// Chat
export const CHAT_MAX_MESSAGE_LENGTH = 2000;
export const CHAT_HISTORY_LIMIT = 100;
export const CHAT_REPLY_SNIPPET = 150;

// Sharing
export const SHARE_MAX_EXPIRY_DAYS = 365;

/** Extensions that may be served inline (raster images + pdf). Nothing else is ever inline. */
export const INLINE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "pdf"]);
export const INLINE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);

/** Extensions previewed as text (returned as JSON, never rendered as HTML). */
export const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt", "log", "md", "markdown", "json", "css", "js", "mjs", "cjs", "ts", "jsx", "tsx",
  "html", "htm", "xml", "csv", "tsv", "sql", "yaml", "yml", "env", "conf", "ini", "toml",
  "sh", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "php", "svg",
]);

/** Extensions editable via /api/drive/text. */
export const EDITABLE_TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "log", "yaml", "yml", "ini", "conf", "toml",
  "xml", "sql", "css", "js", "ts", "jsx", "tsx", "sh", "py", "env", "html", "htm",
]);

/** Content-Type by extension. Used for serving; user-supplied types are never trusted. */
export const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  wav: "audio/wav",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

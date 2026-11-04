/**
 * Shared request/response types between API route handlers and client components.
 * Keep this file free of server-only imports.
 */

export interface ApiError {
  error: string;
  /** Machine-readable reason, e.g. "quota_exceeded", "rate_limited", "not_found", "invalid_input" */
  code?: string;
}

// ---------------------------------------------------------------- Drive

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string;
  created_at: string;
}

export interface FileItem {
  id: string;
  name: string;
  size: number;
  owner_id: string;
  uploaded_at: string;
  folder_id: string | null;
  /** MIME type stored at upload, informational only (server decides how to serve). */
  content_type?: string | null;
}

export interface Breadcrumb {
  id: string;
  name: string;
}

/** GET /api/drive?folderId=<uuid|root> */
export interface DriveListResponse {
  files: FileItem[];
  folders: FolderItem[];
  breadcrumbs: Breadcrumb[];
  totalUsed: number;
  quota: number;
}

/** POST /api/drive/upload  { action: "init", ... } */
export interface UploadInitRequest {
  action: "init";
  name: string;
  size: number;
  type: string;
  folderId: string | null;
  replaceFileId?: string | null;
}

export interface UploadInitResponse {
  /** Presigned PUT URL; client must send the exact Content-Type from `headers`. */
  uploadUrl: string;
  headers: Record<string, string>;
  /** Opaque signed token to pass to the "complete" step. */
  uploadToken: string;
}

/** POST /api/drive/upload  { action: "complete", uploadToken } */
export interface UploadCompleteRequest {
  action: "complete";
  uploadToken: string;
}

export interface UploadCompleteResponse {
  file: FileItem;
  totalUsed: number;
  replaced: boolean;
}

/**
 * POST /api/drive (multipart, legacy/fallback for small files <= 4 MB)
 * fields: file, folderId?, replaceFileId?
 * Response: UploadCompleteResponse
 */

/** POST /api/drive/folders { name, parentId } -> { folder } */
export interface CreateFolderResponse {
  folder: FolderItem;
}

/**
 * POST /api/drive/folders/tree { parentId: string|null, rootName: string, paths: string[] }
 * `paths` are relative directory paths below the root (e.g. ["a", "a/b"]).
 * Creates rootName under parentId, then each nested path. Returns a map from
 * "" (the root) and each relative path to the created folder id.
 */
export interface CreateFolderTreeResponse {
  rootId: string;
  folderIds: Record<string, string>;
}

/** POST /api/drive/folders/delete { folderId } -> FolderDeleteResponse */
export interface FolderDeleteResponse {
  success: true;
  deletedFiles: number;
  deletedFolders: number;
  totalUsed: number;
}

/** GET /api/drive/folders/delete?folderId= -> counts preview for the confirm dialog */
export interface FolderDeletePreview {
  files: number;
  folders: number;
  bytes: number;
}

/** POST /api/drive/delete { fileIds: string[] } -> { success, deleted, totalUsed } */
export interface FileDeleteResponse {
  success: true;
  deleted: number;
  totalUsed: number;
}

/**
 * GET /api/drive/zip?fileIds=a,b,c  or  ?folderId=<uuid>
 * Streams application/zip. Use a plain <a href download> navigation.
 * Preflight first with POST /api/drive/zip { fileIds | folderId, check: true }
 *   -> { ok, files, bytes } or 400/404/413 JSON (max 300 ids per selection).
 * Errors: 400/404/413 JSON.
 */

/**
 * GET /api/drive/download?fileId=<uuid>[&inline=1]
 * inline=1 only honored for raster images (png/jpg/jpeg/gif/webp/avif/bmp) and pdf.
 */

/** GET /api/drive/preview?fileId=<uuid> -> text preview (text-like extensions, <=256 KB) */
export interface TextPreviewResponse {
  content: string;
  truncated?: boolean;
}

/** POST /api/drive/text { name, content, folderId } -> { file, totalUsed }
 *  PUT  /api/drive/text { fileId, name, content } -> { file, totalUsed }
 *  GET  /api/drive/text?fileId= -> { content, name }
 *  content max 1 MB; only text extensions editable. 409 on name collision.
 */
export interface TextSaveResponse {
  file: FileItem;
  totalUsed: number;
}

// ---------------------------------------------------------------- Sharing

export interface ShareItem {
  id: string;
  file_id: string;
  /** null = any signed-in Swosh user holding the link */
  recipient_username: string | null;
  created_at: string;
  expires_at: string | null;
  url: string;
}

/** POST /api/drive/share { fileId, recipient?: string, expiresInDays?: number|null } -> { share } */
export interface CreateShareResponse {
  share: ShareItem;
}

/** GET /api/drive/share?fileId= -> { shares } (active, owner only) */
export interface ListSharesResponse {
  shares: ShareItem[];
}

/** DELETE /api/drive/share { shareId } -> { success: true } */

/** GET /api/drive/share?token=<shareId> -> shared file metadata for the recipient */
export interface SharedFileInfo {
  id: string;
  name: string;
  size: number;
  uploaded_at: string;
  owner_username: string;
  previewKind: "image" | "text" | "pdf" | "none";
  expires_at: string | null;
}

/**
 * GET  /api/drive/share/download?token=       -> attachment stream
 * GET  /api/drive/share/preview?token=        -> image/pdf inline stream, or JSON TextPreviewResponse
 * POST /api/drive/share/save { token, folderId } -> { file, totalUsed }
 */

// ---------------------------------------------------------------- Mail

/**
 * POST /api/send (multipart)
 * fields: to (comma separated, max 5, optional -> default recipient), subject (<=255), body (<=100k chars),
 *         files[] (direct uploads, total <= 4 MB), driveFileIds (JSON string[]), saveToDrive ("true"|"false")
 * Response: { success: true, archived: number }
 */
export interface SendMailResponse {
  success: true;
  archived: number;
}

/** GET /api/send/config -> { defaultRecipient: string|null, maintenance: boolean, maxDirectBytes, maxTotalBytes } */
export interface MailConfigResponse {
  defaultRecipient: string | null;
  maintenance: boolean;
  maxDirectBytes: number;
  maxTotalBytes: number;
}

// ---------------------------------------------------------------- Chat

export interface Conversation {
  id: string;
  save_messages: boolean;
  other_user: {
    id: string;
    username: string;
    /**
     * Last presence heartbeat of the other user (ISO), or null when they went offline
     * or it is unknown. Online = within PRESENCE_ONLINE_WINDOW_MS (src/lib/presence.ts).
     */
    last_seen_at: string | null;
  };
}

/** Item of GET /api/chat/conversations. */
export interface ConversationListItem extends Conversation {
  /** Ids of the latest <= 20 messages NOT sent by the caller, newest first (unread badges while polling). */
  recent_incoming_ids: string[];
}

/** GET /api/chat/conversations -> ConversationsResponse */
export interface ConversationsResponse {
  conversations: ConversationListItem[];
}

export interface ReplyRef {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  reply_to: ReplyRef | null;
  /** true if created while the conversation was in disappearing mode */
  ephemeral: boolean;
  created_at: string;
  edited_at?: string | null;
  /** Echo of the `clientId` sent with POST /api/chat/messages (only on that response and its "message" broadcast). */
  client_id?: string | null;
}

/** POST /api/chat/conversations { username } -> { conversation } */

/** GET /api/chat/messages?conversationId= -> { messages } (never deletes) */
export interface MessagesResponse {
  messages: ChatMessage[];
}

/** POST /api/chat/messages { conversationId, content, replyToId?, clientId? } -> { message } */
export interface SendMessageResponse {
  message: ChatMessage;
}

/** PATCH /api/chat/messages { messageId, content } -> { message } */
/** DELETE /api/chat/messages { messageId } -> { success: true } (404 if not found / not yours) */

/** POST /api/chat/messages/ack { conversationId, messageIds } -> { deleted: string[] }
 *  Recipient confirms it has displayed ephemeral messages; server deletes them. */
export interface AckResponse {
  deleted: string[];
}

/** POST /api/chat/conversations/toggle { conversationId, saveMessages } -> { conversation } */

/**
 * POST /api/chat/presence { state: "online" | "offline" } -> PresenceResponse
 * Heartbeat (every PRESENCE_HEARTBEAT_MS while the page is visible) and sign-off.
 * The server stores users.last_seen_at and broadcasts a "presence" event to every
 * conversation partner's user channel (at most once per PRESENCE_MIN_REFRESH_MS).
 */
export interface PresenceResponse {
  online: boolean;
  /** Server clock (ISO), lets clients correct for clock skew when comparing last_seen_at. */
  server_time: string;
}

export interface PresencePayload {
  user_id: string;
  online: boolean;
  /** ISO timestamp when online, null when the user went offline. */
  last_seen_at: string | null;
}

/**
 * GET /api/chat/realtime-token -> { token, expiresAt }  (use NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY for url/apikey)
 * Short-lived Supabase JWT (role "authenticated", sub = userId) for private channels.
 * 503 { code: "realtime_unconfigured" } when SUPABASE_JWT_SECRET is missing -> client falls back to polling.
 */
export interface RealtimeTokenResponse {
  token: string;
  /** Epoch milliseconds (compare with Date.now()). */
  expiresAt: number;
}

/**
 * Realtime (server -> client only; clients cannot broadcast, RLS forbids it):
 *   private channel `swoshchat:conv:<conversationId>` events:
 *     "message"        payload ChatMessage
 *     "message_edited" payload ChatMessage
 *     "message_deleted" payload { id: string }
 *     "messages_consumed" payload { ids: string[] }   (ephemeral messages read & deleted)
 *     "settings"       payload { save_messages: boolean, changed_by: string }
 *   private channel `swoshchat:user:<userId>` events:
 *     "message"        payload ChatMessage (for unread badges in other conversations / nav)
 *     "conversation"   payload Conversation (someone started a chat with you)
 *     "presence"       payload PresencePayload (a conversation partner came online / went offline)
 * There is no client-tracked presence channel: presence is server-authoritative.
 */
export type RealtimeEvent =
  | { event: "message"; payload: ChatMessage }
  | { event: "message_edited"; payload: ChatMessage }
  | { event: "message_deleted"; payload: { id: string } }
  | { event: "messages_consumed"; payload: { ids: string[] } }
  | { event: "settings"; payload: { save_messages: boolean; changed_by: string } }
  | { event: "conversation"; payload: Conversation }
  | { event: "presence"; payload: PresencePayload };

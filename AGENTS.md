<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Swosh Workspace — AI Agent Guidelines & Architecture Manual

Swosh Workspace is a glassmorphic dark-mode productivity app combining **Swoshmail** (SMTP email), **Swosh Drive** (object storage + Supabase metadata) and **Swosh Chat** (Supabase Realtime messaging).

This file is the single source of truth for all coding agents (`CLAUDE.md`, `GEMINI.md`, `.cursorrules` and `.github/copilot-instructions.md` point here).

---

## 1. Golden Rules

1. **No native browser dialogs.** Never call `window.alert/confirm/prompt`. Use `Modal` / `ConfirmModal` (`src/components/ui/Modal.tsx`) and `useToast()` (`src/components/ui/Toast.tsx`).
2. **No vendor names in UI copy.** Never show "R2", "Cloudflare" or "Vercel" to users (including error messages). Say "Swosh Drive", "Drive" or "Cloud Storage". API routes return generic messages; raw errors are only logged server-side.
3. **No icon libraries.** Icons are inline SVGs in `src/components/Icons.tsx` built on `BaseIcon` (sets `aria-hidden`/`focusable`). Add new icons there.
4. **Node 24.** `source /home/jon/.nvm/nvm.sh && nvm use 24` before running commands.
5. **Verify before finishing:** `npm run typecheck`, `npm run lint` (zero warnings), `npm test`. CI (`.github/workflows/ci.yml`) also runs `npm run build` with dummy env.
6. **Preserve the Next.js agent block** at the top of this file; `next dev` regenerates it.
7. **Shared contract.** Request/response types live in `src/types/api.ts` and are imported by both route handlers and client code. Change them there first.

---

## 2. Stack

- Next.js 16 (App Router, Turbopack, React Compiler), React 19, strict TypeScript
- Supabase Postgres (service-role key on the server only) + Supabase Realtime (private channels)
- S3-compatible object storage via `@aws-sdk/client-s3` (+ presigned uploads)
- NextAuth v4 credentials provider, scrypt password hashes
- Nodemailer 10 (SMTP)
- Vitest for unit tests

---

## 3. Project Structure

```
src/
├── app/
│   ├── api/                      # Route handlers (all wrapped in route() from lib/http.ts)
│   │   ├── auth/[...nextauth]/
│   │   ├── chat/conversations/   # list/create (+ toggle/)
│   │   ├── chat/messages/        # GET/POST/PATCH/DELETE (+ ack/)
│   │   ├── chat/realtime-token/  # short-lived Supabase JWT for private channels
│   │   ├── chat/presence/        # presence heartbeat (online/offline)
│   │   ├── drive/                # list (GET) + small multipart upload fallback (POST)
│   │   ├── drive/upload/         # presigned upload init/complete
│   │   ├── drive/{delete,download,preview,text,zip}/
│   │   ├── drive/folders/        # create (+ tree/, delete/)
│   │   ├── drive/share/          # create/list/revoke (+ download/, preview/, save/)
│   │   └── send/                 # mail dispatch (+ config/)
│   ├── globals.css               # tokens → base → primitives → shell → modules → chat → responsive
│   ├── layout.tsx, providers.tsx # SessionProvider + ToastProvider
│   └── page.tsx                  # server component → components/layout/AppRoot
├── components/
│   ├── auth/ layout/ mail/ drive/ drive/modals/ chat/   # feature components
│   ├── ui/                       # Modal, ConfirmModal, Toast, Menu
│   ├── ChatPanel.tsx             # chat entry (loaded with next/dynamic, kept mounted)
│   └── Icons.tsx
├── hooks/                        # useDriveListing, useDriveUploads, useUrlState, useMailDraft, ...
│   └── chat/                     # useRealtime, usePresence, useConversation, messagesReducer, guards, unread
├── lib/                          # server: session, http, drive, files, folders, serve, shares,
│   │                             #         chat, chat-format, mail, realtime, upload-token,
│   │                             #         rate-limit, presence (shared pure helpers), constants,
│   │                             #         supabase, r2, auth, crypto
│   ├── client/                   # browser-only helpers (api, upload, download, files, realtime)
│   └── __tests__/                # Vitest unit tests
└── types/                        # api.ts (shared contract), next-auth.d.ts
supabase_setup.sql                # idempotent schema + migration + RLS + realtime policies
scripts/hash-password.mjs         # create users (prints an INSERT)
scripts/test-email.mjs            # SMTP diagnostics (CLI only)
```

---

## 4. Module Conventions

### Swoshmail
- `GET /api/send/config` exposes the default recipient (`EMAIL_TO`), maintenance flag (`MAIL_MAINTENANCE`) and size limits.
- `POST /api/send`: at most 5 recipients, subject ≤ 255, body ≤ 100k chars, direct attachments ≤ 4 MB, total ≤ 20 MB.
- Order: validate → read Drive attachments (owner-checked) → insert `email_logs` row `pending` → send → mark `sent`/`failed` → archive direct attachments to Drive (only if requested and the send succeeded).

### Swosh Drive
- **Quota:** 1 GB per user, enforced atomically in Postgres: a trigger on `files` maintains `users.storage_used` and raises `quota_exceeded` (→ HTTP 413) on overflow. Never sum sizes in JS.
- **Object keys:** `drives/${userId}/${crypto.randomUUID()}`; the display name lives only in the DB (`sanitizeFileName`).
- **Uploads:** `POST /api/drive/upload` `{action:"init"}` returns a presigned PUT bound to the exact byte count, then `{action:"complete"}` with the signed upload token. Multipart `POST /api/drive` is a fallback for files ≤ 4 MB. Use `storeFile()` / `replaceFileObject()` from `lib/drive.ts` (rollback on DB failure; replace = upload new → update row → delete old).
- **Folder uploads** preserve nested structure via `POST /api/drive/folders/tree`.
- **Ownership:** composite FKs guarantee a file's folder (and a folder's parent) belong to the same owner; still call `assertFolderOwned()` for clean 404s.
- **Serving files:** always use `fileResponseHeaders()` (`lib/files.ts`): Content-Type from the extension, inline only for raster images and PDF, `nosniff`, sandboxed CSP, RFC 5987 filenames. SVG/HTML are always attachments.
- **Deletes:** DB rows first, then batch object deletes (orphans are logged, dangling rows are not possible).
- **ZIP:** `POST /api/drive/zip {check:true}` preflight, then streamed `GET` (≤ 2000 files, ≤ 2 GB, ≤ 300 selected ids).
- **Sharing:** rows in `file_shares` (optional recipient, expiry, revocation). The token is the share id. Links reflect the latest version of the file.

### Swosh Chat
- **Realtime is server → client only.** Route handlers broadcast through `lib/realtime.ts`; RLS on `realtime.messages` forbids client broadcasts. Clients subscribe to private channels after `GET /api/chat/realtime-token`:
  - `swoshchat:conv:<conversationId>` — `message`, `message_edited`, `message_deleted`, `messages_consumed`, `settings`
  - `swoshchat:user:<userId>` — `message`, `conversation` (unread badges), `presence`
- **Presence is server-authoritative.** There is no client-tracked Supabase presence channel and no INSERT policy on `realtime.messages`, so nobody can claim to be someone else. The client (`hooks/chat/usePresence.ts`) POSTs `/api/chat/presence {state:"online"}` every 25 s while the page is visible. Hiding a tab only stops heartbeats (status expires after 70 s). `{state:"offline"}` (fetch `keepalive`, `sendBeacon` fallback) is sent on `pagehide` (unless another visible tab of the same user is still beating, coordinated over a `BroadcastChannel`) and on sign-out (`signOffPresence()`). The route writes `users.last_seen_at` (now / NULL) with a conditional update, so it only writes and broadcasts a `presence` event `{user_id, online, last_seen_at}` to each partner's user channel on a transition or when the stored value is older than 20 s, however many tabs are open. `GET /api/chat/conversations` returns `other_user.last_seen_at`. A partner is online when `isOnline(last_seen_at, now)` (`lib/presence.ts`, 70 s window, skew-corrected with the response's `server_time`, re-evaluated every 10 s). Constants live in `lib/presence.ts`.
- Without `SUPABASE_JWT_SECRET` the client falls back to polling (messages every 4 s, conversation list every 20 s).
- **Unread badges while polling:** each list item carries `recent_incoming_ids` (latest ≤ 20 incoming message ids, newest first; one `swosh_recent_incoming` RPC for all conversations). `ChatPanel` keeps one shared "seen ids" set: the first list load seeds it, realtime events and open-conversation loads add to it, and only in polling mode do new list ids increment the badge (unless that conversation is on screen with the tab visible). Every id is counted once, whichever path sees it first.
- **Content envelope:** `{"v":1,"text":...,"reply_to_id":...,"reply_snapshot":...}` (`lib/chat-format.ts`); legacy plain strings and `{text, reply_to}` are still parsed. Reply quotes and sender names are resolved on the server.
- **Disappearing mode:** messages are stored with `ephemeral = true` and deleted when the recipient acknowledges them (`POST /api/chat/messages/ack`) after displaying them. Mode changes apply to new messages only.
- **Keep-history mode:** a trigger keeps at most 100 non-ephemeral messages per conversation.
- Chat UI: `role="log"` message list, Esc cancels reply/edit, unread count reported to the shell via `onUnreadChange` (the shell owns `document.title`).

---

## 5. Security & Access Control

1. **Session:** every route starts with `const user = await requireUser();` (`lib/session.ts`); session types are augmented in `src/types/next-auth.d.ts` (no `as any`).
2. **Scoping:** files and folders `.eq("owner_id", user.id)`; conversations via participant checks (`lib/chat.ts`).
3. **Database:** RLS is enabled on every table with no anon/authenticated policies, and privileges are revoked; only the service role (server) can read or write.
4. **Rate limiting:** `await enforceRateLimit()` (`lib/rate-limit.ts`) on every route. **It is async: always `await` it** (a floating promise silently disables the limit). Two layers of the same sliding window: an in-memory per-process log rejects early without a DB call; otherwise the `swosh_rate_limit(key, limit, window_ms)` RPC decides. It stores hits in `rate_limit_hits`, takes a per-key advisory lock and is shared by every instance. If the RPC fails (e.g. migration not run), the error is logged once, the DB layer is skipped for 60 s, and the memory result is used. Windows must stay ≤ 1 day (older hits are purged). Login (`lib/auth.ts`, `checkRateLimit`) is limited per username (5/min) and per IP (20/min) through the same shared path. Mail additionally has its `email_logs` limit (5/min, 30/hour). Presence: 20/min.
5. **Errors:** throw `HttpError` helpers from `lib/http.ts` (`badRequest`, `notFound`, `tooLarge`, ...). Unknown errors are logged and returned as a generic 500 `server_error`.
6. **Headers:** CSP, frame-ancestors, HSTS, nosniff, Referrer-Policy and Permissions-Policy are set in `next.config.ts`. The CSP `connect-src` is computed at build time from `NEXT_PUBLIC_SUPABASE_URL` and the storage endpoint.

---

## 6. Commands

```bash
source /home/jon/.nvm/nvm.sh && nvm use 24
npm run dev          # dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
npm run build        # production build (works without secrets)
npm run hash-password -- <username> <password>
npm run test-email
```

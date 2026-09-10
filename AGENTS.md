<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Swosh Workspace — AI Agent Guidelines & Architecture Manual

Swosh Workspace is a unified, glassmorphic dark-mode productivity platform integrating **Swoshmail** (SMTP email client), **Swosh Drive** (cloud storage with R2 and Supabase), and **Swosh Chat** (real-time messaging with Supabase Realtime).

---

## 1. Golden Rules (Must Always Follow)

1. **NO Native Browser Dialogs**: NEVER use `window.alert()`, `window.confirm()`, or `window.prompt()`. All prompts, confirmations, and alerts must be rendered as custom glassmorphic modals or toasts within the application.
2. **NO Cloudflare R2 Mentions in UI**: Do not display "Cloudflare R2" or "R2" on user-facing UI elements. Refer to storage generically as "Swosh Drive", "Drive", or "Cloud Storage".
3. **No External Icon Libraries**: Do NOT install or import `lucide-react`, `@heroicons`, or `react-icons`. All icons are hand-crafted SVG components located in `src/components/Icons.tsx`. When a new icon is required, add it directly to `src/components/Icons.tsx`.
4. **Node Environment**: Node v20+ or v24+ is required. When running shell commands, activate Node 24: `source /home/jon/.nvm/nvm.sh && nvm use 24`.
5. **Always Typecheck**: Always verify TypeScript compilation before declaring any task complete using `npx tsc --noEmit`.
6. **Preserve Next.js Agent Block**: Never delete the `<!-- BEGIN:nextjs-agent-rules -->` block in `AGENTS.md`; `next dev` automatically regenerates it if altered.

---

## 2. Technology Stack & Runtime

- **Framework**: Next.js 16 (App Router, Turbopack, React 19)
- **Styling**: Custom Glassmorphism CSS (`src/app/globals.css`), CSS variables, dark-mode only (`#060814` background)
- **Database**: Supabase (PostgreSQL with Realtime WebSockets)
- **Blob Storage**: Cloudflare R2 via `@aws-sdk/client-s3`
- **Authentication**: NextAuth.js v4 (Credentials Provider with SHA-256 + salt password hashing)
- **Email Delivery**: Nodemailer (SMTP transport)
- **Type Checking**: Strict TypeScript 5 (`tsconfig.json`)

---

## 3. Project Structure & Key Files

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/             # [...nextauth] route handler
│   │   │   ├── chat/
│   │   │   │   ├── conversations/# Conversation list & create
│   │   │   │   ├── messages/     # Chat messages GET/POST/PUT/DELETE
│   │   │   │   └── toggle/       # Ephemeral vs Persistent mode toggle
│   │   │   ├── drive/
│   │   │   │   ├── folders/      # Folder CRUD and nested contents
│   │   │   │   ├── download/     # Secure file download stream
│   │   │   │   ├── preview/      # Inline file preview stream
│   │   │   │   └── route.ts      # File upload, list, delete, replace
│   │   │   └── send/             # Nodemailer email dispatch
│   │   ├── globals.css           # Design tokens, glassmorphism utilities, responsive styles
│   │   ├── layout.tsx            # Root layout with SessionProvider
│   │   └── page.tsx              # Main dashboard: Mail, Drive, and Chat toggle/tabs
│   ├── components/
│   │   ├── ChatPanel.tsx         # Real-time chat client, replies, presence, editing
│   │   └── Icons.tsx             # Project SVG icon definitions
│   └── lib/
│       ├── auth.ts               # NextAuth options and credentials validation
│       ├── crypto.ts             # Password hashing utilities
│       ├── r2.ts                 # S3/R2 client (uploadToR2, deleteFromR2, getFileFromR2)
│       ├── rate-limit.ts         # In-memory sliding-window rate limiter
│       └── supabase.ts           # Supabase client instances (anon + service role)
├── supabase_setup.sql            # Database schema, indexes, and foreign keys
├── .env.example                  # Environment variable reference
└── tsconfig.json                 # TypeScript configuration (@/* alias)
```

---

## 4. Module Conventions & Architecture

### 📬 Swoshmail
- Handles sending emails via Nodemailer SMTP (`/api/send`).
- Attachments can originate from:
  1. Local device file upload.
  2. Direct selection from existing Swosh Drive files (without re-uploading).
- Optional toggle: automatically saves sent attachments into Swosh Drive.
- Rate-limited to prevent SMTP spamming.

### 💾 Swosh Drive
- **Storage Limits**: Strictly enforced 1 GB personal quota (`ONE_GB = 1024 * 1024 * 1024`). Always validate against quota both in client state and backend `/api/drive/route.ts`.
- **R2 Storage Key Convention**: `drives/${userId}/${Date.now()}-${fileName}`.
- **Multi-File Uploads**: Supports batch selection (`multiple` file input) and multi-file drag-and-drop.
- **Folder Uploads**: Directory uploads preserve nested structure. Prompt user via custom glass modal:
  - *Create Subfolder*: Creates parent folder record in Supabase and places nested files inside.
  - *Upload Flat*: Uploads all files directly into current working folder.
- **Duplicate Conflict Resolution**: When an uploaded file name matches an existing file in the current directory:
  - Prompt user with custom modal: **Replace** or **Keep Both (1)**.
  - *Replace*: Calls backend with `replaceFileId`, deletes old R2 object, uploads new object, and updates existing Supabase row.
  - *Keep Both*: Appends ` (1)`, ` (2)` etc. to the file name and uploads as a new file.
- **Cascading Deletions**: Deleting a folder deletes all child folders, child files in Supabase, and their corresponding R2 objects.
- **Previews**: Files are streamed through `/api/drive/preview` with proper `Content-Type` for inline display (images, markdown, code, text, CSV).

### 💬 Swosh Chat
- **Real-time Engine**: Supabase Realtime WebSocket broadcast channel (`chat:${conversationId}`).
- **Dual Persistence Modes**:
  - *Disappearing Mode (`save_messages = false`)*: Ephemeral Snapchat mechanics. Messages are deleted from Supabase immediately after being fetched/viewed by the recipient.
  - *Keep History Mode (`save_messages = true`)*: Messages are retained, but automatically pruned using a sliding window capped at 100 messages to prevent database bloat.
- **Zero-Migration Reply Metadata**:
  - Quoted replies serialize metadata into `content` as JSON: `{"text": "Actual message", "reply_to": {"id": "...", "content": "...", "sender_name": "..."}}`.
  - Non-replies remain plain strings.
  - Always handle both formats gracefully when parsing messages.
- **UX Features**:
  - Clicking a reply quote scrolls smoothly to `#message-${replyTo.id}` with an animated glow highlight.
  - <kbd>Esc</kbd> key cancels active reply or edit mode.
  - Tab title unread counter (`(N) Swosh Chat`) updates when document is hidden.
  - Real-time online presence indicators.
  - Automated ping/pong responder for latency testing.

---

## 5. Security & Access Control

1. **Session Enforcement**: Every API route handler must verify session identity via `getServerSession(authOptions)`:
   ```typescript
   const session = await getServerSession(authOptions);
   if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
   const userId = (session.user as any).id;
   ```
2. **User Isolation**: Verify ownership on all CRUD operations:
   - Files: `.eq("owner_id", userId)`
   - Folders: `.eq("user_id", userId)`
   - Conversations: `.or(\`user1_id.eq.\${userId},user2_id.eq.\${userId}\`)`
3. **Rate Limiting**: Apply sliding-window rate limit checks from `@/lib/rate-limit.ts` to every sensitive mutation:
   - Chat: 30 messages/min
   - Uploads: 20 uploads/min
   - Email: 10 sends/min
   - Auth/Register: 5 attempts/min

---

## 6. Common Development Commands

```bash
# Node 24 environment setup
source /home/jon/.nvm/nvm.sh && nvm use 24

# Start development server
npm run dev

# Run TypeScript typecheck (zero tolerance for errors)
npx tsc --noEmit

# Run Next.js linter
npm run lint

# Build for production
npm run build
```


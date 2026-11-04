# Swosh Workspace

A unified, glassmorphic dark-mode productivity dashboard integrating an email client, a cloud drive, and a real-time messaging suite into a single cohesive SaaS workspace.

---

## Key Modules & Features

### 📬 Swoshmail (Email Client)
- **SMTP dispatch** via Nodemailer, up to 5 recipients (or the configured default recipient).
- **Dual attachments:** files from your device (up to 4 MB) or files already in Swosh Drive (up to 20 MB total), without re-uploading.
- **Save to Drive:** optionally archive device attachments to Swosh Drive after a successful send.
- **Draft safety:** drafts persist per user for the session and warn before you leave with unsent changes.

### 💾 Swosh Drive (Cloud Storage)
- **Direct uploads:** files go straight from the browser to storage with per-file progress and cancel; small files fall back to a server upload.
- **Folder uploads** keep their nested structure (or upload flat, your choice).
- **Duplicate handling:** Replace existing, Keep both (`name (1).ext`), Skip, or Cancel all.
- **Multi-select:** batch delete and streamed ZIP downloads (whole folders too, including empty subfolders).
- **Previews** for images, PDFs and text/code files; built-in note editor for text files.
- **Sharing:** links for any signed-in Swosh user or for one specific user, with optional expiry and revocation.
- **Quota:** 1 GB per user, enforced atomically by the database.

### 💬 Swosh Chat (Real-Time Messaging)
- **Private realtime channels:** only conversation participants receive events; clients cannot broadcast.
- **Disappearing mode (default):** messages are deleted once the recipient has seen them. A banner is always visible while the mode is on.
- **Keep-history mode:** persistent history, capped at the latest 100 messages.
- **Replies, edits and deletes** with server-verified quotes, presence, per-conversation unread badges, and a polling fallback when realtime is unavailable.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org/) (App Router, Turbopack, React Compiler) |
| **Frontend** | [React 19](https://react.dev/), TypeScript, custom glassmorphism CSS |
| **Database & Realtime** | [Supabase](https://supabase.com/) (PostgreSQL with RLS, Realtime private channels) |
| **Object Storage** | S3-compatible bucket via `@aws-sdk/client-s3` (presigned uploads) |
| **Authentication** | [NextAuth.js](https://next-auth.js.org/) credentials provider (scrypt hashes) |
| **Mail Dispatch** | [Nodemailer](https://nodemailer.com/) 10 (SMTP) |
| **Tests** | [Vitest](https://vitest.dev/) |

---

## Getting Started

### Prerequisites
- **Node.js** 24
- **npm** 10+

### 1. Clone & install
```bash
git clone https://github.com/TheJonathanC/swoshmail.git
cd swoshmail
npm ci
```

### 2. Environment
Copy `.env.example` to `.env.local` and fill it in. Every variable is documented there, including:
- `NEXTAUTH_SECRET` (required, ≥ 16 chars; also signs upload tokens)
- `SUPABASE_SERVICE_ROLE_KEY` (server only) and `SUPABASE_JWT_SECRET` (the project's legacy JWT secret, used to mint short-lived realtime tokens)
- storage credentials, SMTP settings, `EMAIL_TO` (default recipient) and `MAIL_MAINTENANCE`

`NEXT_PUBLIC_SUPABASE_URL` and the storage account/endpoint are read **at build time** to build the Content-Security-Policy, so set them in the build environment too.

### 3. Database
Run `supabase_setup.sql` in the Supabase **SQL Editor**. It is idempotent: on a fresh project it creates everything, and on an existing project the MIGRATION section upgrades the schema in place. It also:
- enables Row-Level Security on every table and revokes anon/authenticated access (the app only uses the service role on the server);
- adds the quota trigger, history pruning trigger, breadcrumb/tree RPCs and the `file_shares` table;
- creates the Realtime authorization policies for the private chat channels.

Create users with `npm run hash-password -- <username> <password>` and run the printed `INSERT`.

### 4. Supabase & storage settings
1. **Realtime → Settings:** disable *Allow public access* so only private channels work.
2. **Bucket CORS:** allow `PUT` from your app origins with the `Content-Type` header (exact JSON in `.env.example`). Keep the bucket private.

### 5. Run
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

### Quality checks
```bash
npm run typecheck && npm run lint && npm test && npm run build
```
The same checks run in CI (`.github/workflows/ci.yml`); the build does not need real secrets.

---

## Project Structure

See [AGENTS.md](./AGENTS.md#3-project-structure) for the full annotated layout. In short: route handlers in `src/app/api`, feature components in `src/components/{auth,layout,mail,drive,chat,ui}`, hooks in `src/hooks`, server helpers in `src/lib`, browser helpers in `src/lib/client`, and the shared API contract in `src/types/api.ts`.

---

## Security Highlights
- **Database lockdown:** RLS on every table with no public policies; the browser never talks to tables directly.
- **Private realtime:** short-lived per-user tokens, participant-only channels, server-side broadcasting.
- **Safe file serving:** content type from the extension, inline only for images and PDFs, sandboxed responses, `nosniff`.
- **Atomic quota:** enforced by a database trigger, so concurrent uploads cannot exceed 1 GB.
- **Hardened auth:** scrypt hashes, constant-time comparison, login rate limits per username and IP, periodic session revalidation.
- **Rate limiting** on every API route, plus a database-backed limit for email.
- **Security headers:** CSP, `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy.

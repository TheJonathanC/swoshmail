@AGENTS.md

# CLAUDE.md — Claude Code Project Guidelines for Swosh Workspace

This document provides essential instructions, commands, architecture details, and coding conventions for Claude Code when working in the **Swosh Workspace** repository.

---

## 1. Environment & Quick Commands

- **Node.js**: Node 24 is installed and required. Always run commands using:
  ```bash
  source /home/jon/.nvm/nvm.sh && nvm use 24
  ```
- **Development Server**: `npm run dev` (Runs Next.js 16 with Turbopack on http://localhost:3000)
- **Type Checking**: `npx tsc --noEmit` (**Mandatory verification step before finishing any task**)
- **Linting**: `npm run lint` (ESLint 9 with Next.js 16 plugin)
- **Production Build**: `npm run build`

---

## 2. Core Project Architecture

Swosh Workspace is a unified dark-mode SaaS dashboard written in Next.js 16 (App Router) and React 19:

1. **Swoshmail (Email Dispatch)**:
   - SMTP dispatch via Nodemailer (`src/app/api/send/route.ts`).
   - Supports dual attachments: direct device uploads and direct links to files already in Swosh Drive.
   - Optional auto-archive toggle to save sent attachments to Swosh Drive.

2. **Swosh Drive (Cloud Storage)**:
   - Object storage via Cloudflare R2 (`src/lib/r2.ts`) using `@aws-sdk/client-s3`.
   - File & folder metadata tracked in Supabase (`src/app/api/drive/route.ts`, `src/app/api/drive/folders/route.ts`).
   - Strict 1 GB personal quota (`ONE_GB = 1024 * 1024 * 1024`) enforced on client and server.
   - Multi-file batch upload support.
   - Directory/folder upload support with interactive user prompt (Create Subfolder vs Upload Flat).
   - Duplicate filename conflict resolution (Replace vs Keep Both with numbered suffix).
   - Cascading folder deletion and inline preview streaming (`/api/drive/preview`).

3. **Swosh Chat (Real-time Messaging)**:
   - Real-time messaging powered by Supabase Realtime WebSockets (`src/components/ChatPanel.tsx`).
   - Dual history modes:
     - Ephemeral / Disappearing Mode: Messages self-delete immediately after the recipient reads them.
     - Keep History Mode: Persistent chat with automatic sliding-window pruning (capped at 100 messages).
   - Zero-migration message replies: Reply references are encoded into message content as `{"text": "...", "reply_to": {...}}`.
   - Click-to-jump smooth scrolling with glow highlight on quoted messages.
   - Real-time presence indicators, unread tab notifications, and <kbd>Esc</kbd> dismiss shortcut.

---

## 3. Strict Rules & Conventions

### 🚨 UI & Dialog Constraints
- **NEVER use browser dialogs**: Under no circumstances should `window.alert`, `window.confirm`, or `window.prompt` be called. Every prompt or alert must be a custom glassmorphic modal or animated toast.
- **NO "Cloudflare R2" on UI**: Never expose the name "Cloudflare R2" or "R2" in user-facing UI copy. Use "Swosh Drive", "Drive", or "Cloud Storage".
- **Icons**: Do NOT install external icon libraries (lucide-react, react-icons, heroicons). All icons are inline SVG components in `src/components/Icons.tsx`. Add new icons directly to that file.

### 🎨 Styling & Design System
- Dark-mode glassmorphism theme exclusively (`src/app/globals.css`).
- Use CSS variables for colors:
  - `--background`: `#060814`
  - `--card-bg`: `rgba(15, 23, 42, 0.45)` with `backdrop-filter: blur(16px)`
  - `--primary`: `#6366f1` / `--accent`: `#a855f7`
  - `--text-muted`: `#94a3b8`
- Responsive design: All card layouts, toolbars, and action buttons must adapt gracefully to mobile and large screens without wrapping awkwardly or breaking alignment.

### 🔒 Security & Backend
- **Session Auth**: Every API route must validate `await getServerSession(authOptions)`.
- **User Scoping**: Always scope Supabase queries by user ID (`owner_id` for files, `user_id` for folders, participant check for chat).
- **Rate Limiting**: Always invoke `checkRateLimit` from `src/lib/rate-limit.ts` on new API mutation endpoints.
- **Next.js 16 Rules**: Follow Next.js 16 App Router conventions. In route handlers, return `NextResponse.json(...)`.

---

## 4. Verification Workflow for Claude

Before concluding any implementation or refactoring task:
1. Run `source /home/jon/.nvm/nvm.sh && nvm use 24 && npx tsc --noEmit` to verify TypeScript clean compilation.
2. Verify responsive layout on mobile/desktop breakpoints if UI changes were made.
3. Verify that no native alerts or R2 references were introduced.
4. Ensure clean git status and commit with descriptive messages when requested.

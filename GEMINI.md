# GEMINI.md — Gemini Code Assist & Antigravity Guidelines for Swosh Workspace

This document defines core instructions and architectural constraints for Google Gemini Code Assist and Antigravity agents working in the Swosh Workspace codebase.

---

## 1. Project Overview
Swosh Workspace is a high-performance, dark-mode SaaS dashboard uniting:
- **Swoshmail**: SMTP email dispatch via Nodemailer (`/api/send`) with local and Drive attachment support.
- **Swosh Drive**: Cloud file and folder storage powered by Cloudflare R2 (`src/lib/r2.ts`) and Supabase metadata (`/api/drive`).
- **Swosh Chat**: Real-time WebSocket messaging via Supabase Realtime channels (`src/components/ChatPanel.tsx`), supporting both ephemeral disappearing messages and persistent sliding-window histories, along with quoting/replies.

---

## 2. Fundamental Constraints

1. **Zero Browser Alerts**: Never use `window.alert()`, `window.confirm()`, or `window.prompt()`. Always design or invoke glassmorphic UI modals.
2. **Branding Constraint**: Never mention "Cloudflare R2" on the UI; use "Swosh Drive", "Drive", or "Cloud Storage".
3. **Icon Library**: Use only the custom SVG icons defined in `src/components/Icons.tsx`.
4. **Node 24 Runtime**: Ensure all shell commands execute under Node 24 (`source /home/jon/.nvm/nvm.sh && nvm use 24`).
5. **Type Safety**: Verify zero TypeScript errors with `npx tsc --noEmit`.

---

## 3. Storage & Realtime Specifics
- **1 GB Quota**: Both client UI and server endpoint enforce `1024 * 1024 * 1024` byte storage limit.
- **Upload Key**: `drives/${userId}/${Date.now()}-${fileName}`.
- **Folder Uploads**: Handle folder uploads with interactive modal: Subfolder creation vs Flat upload.
- **Conflict Handling**: Duplicate uploads offer Replace vs Keep Both (1).
- **Chat Replies**: Serialized as `{"text": "...", "reply_to": {...}}` inside message content.
- **Sliding Window**: Persistent chat is capped at 100 messages to prevent database bloat.

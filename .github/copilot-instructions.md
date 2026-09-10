# GitHub Copilot Instructions for Swosh Workspace

Follow these repository rules and patterns when generating code for Swosh Workspace:

## Tech Stack
- Next.js 16 (App Router) with React 19 and TypeScript.
- Supabase for PostgreSQL database, session management, and Realtime WebSockets.
- Cloudflare R2 via `@aws-sdk/client-s3` for object storage.
- Custom dark-mode glassmorphic CSS in `src/app/globals.css`.

## Mandatory Rules
- **No Native Dialogs**: Do not call `window.alert()`, `window.confirm()`, or `window.prompt()`. Use the app's custom modal system.
- **No R2 in UI Copy**: Refer to storage as "Swosh Drive", "Drive", or "Cloud Storage".
- **Icons**: Import only from `src/components/Icons.tsx`.
- **Node.js**: Code targets Node 24 runtime.
- **Drive Quota**: Enforce the 1 GB quota (`1024 * 1024 * 1024` bytes).
- **Chat Replies**: Parse and serialize reply metadata using `{"text": "...", "reply_to": {...}}` JSON payload inside the message `content` column.

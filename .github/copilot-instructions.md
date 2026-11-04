# GitHub Copilot instructions for Swosh Workspace

Follow AGENTS.md in the repository root. It is the single source of truth for architecture, conventions, security rules and commands.

- No `window.alert/confirm/prompt`: use `Modal`/`ConfirmModal` and `useToast()` from `src/components/ui`.
- No "R2"/"Cloudflare"/"Vercel" in user-facing copy.
- Icons only from `src/components/Icons.tsx`.
- Shared request/response types live in `src/types/api.ts`.
- API routes: `requireUser()`, owner scoping, `enforceRateLimit()`, errors via `src/lib/http.ts`.
- Drive quota is enforced by a database trigger; object keys are random UUIDs.

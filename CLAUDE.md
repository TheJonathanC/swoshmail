@AGENTS.md

# CLAUDE.md — Claude Code notes for Swosh Workspace

All architecture, conventions and rules live in **AGENTS.md** (imported above). Claude-specific reminders:

- Activate Node 24 first: `source /home/jon/.nvm/nvm.sh && nvm use 24`.
- Before finishing any task run `npm run typecheck`, `npm run lint` and `npm test`; for UI changes also check the layout at 390px, 900px and 1440px.
- Never use `window.alert/confirm/prompt`; never show "R2"/"Cloudflare"/"Vercel" in UI copy; icons only from `src/components/Icons.tsx`.
- Every API route: `requireUser()`, owner scoping, `enforceRateLimit()`, errors via `lib/http.ts`.
- Commit only when asked, with descriptive messages.

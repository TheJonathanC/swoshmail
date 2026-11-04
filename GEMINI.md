# GEMINI.md — Gemini Code Assist / Antigravity

Read and follow **[AGENTS.md](./AGENTS.md)**. It is the single source of truth for architecture, conventions, security rules and commands in this repository.

Key rules: no native browser dialogs (use `Modal`/`useToast`), no "R2"/"Cloudflare"/"Vercel" in UI copy, icons only from `src/components/Icons.tsx`, shared API types in `src/types/api.ts`, and run `npm run typecheck && npm run lint && npm test` before finishing.

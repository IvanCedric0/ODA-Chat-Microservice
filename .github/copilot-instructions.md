# GitHub Copilot Instructions (`oda-chat-service`)

Always read and follow [`AGENTS.md`](../AGENTS.md), [`shared/contracts.ts`](../shared/contracts.ts), and [`CONTRACT.md`](../CONTRACT.md) before making changes.

## Hard Rules
1. **Do NOT cross workspace boundaries:**
   - On `feat/frontend` (or frontend tasks), ONLY edit files in `client/`. **NEVER** create or edit backend files (`src/app.ts`, `src/server.ts`, `src/config/`, `prisma/`, root `package.json`, `test/`). The backend already exists in `src/`.
   - On `feat/backend` (or backend tasks), ONLY edit `src/`, `prisma/`, and root `package.json`.
2. **Use `camelCase` everywhere — strictly match `shared/contracts.ts`:**
   - Message fields: `id`, `topicId`, `senderId`, `content`, `isDeleted`, `createdAt`.
   - Topic fields: `id`, `serviceName`, `title`, `participantIds`.
   - Query/param names: `topicId`, `messageId`, `userIds`, `beforeId`, `limit`.
   - Socket.io events: `join_topic({ topicId })`, `send_message({ topicId, content })`, `delete_message({ topicId, messageId })`, `room_joined({ topicId, history })`, `new_message`, `message_deleted({ topicId, messageId })`, `error_event({ code, message })`.
   - **NEVER** use `snake_case` (`sender_id`, `created_at`, `before_id`, `message_id`, `user_ids`).
3. **Widget security (`CONTRACT.md`):**
   - Never pass JWT in the iframe URL (`/embed/?topicId=<number>` only). Always exchange JWT via `window.postMessage` (`CHAT_READY` / `SET_AUTH_TOKEN`) with strict `VITE_CHAT_PARENT_ORIGINS` origin verification.
4. **Tech & tooling:**
   - `client/` uses React 19 in **plain JS/JSX** (no TypeScript). Verify with `npm --prefix client run build` and `npm --prefix client run lint`.
   - `src/` uses TypeScript ESM + Fastify + Prisma 7 + `node:test` via `tsx` (`npm test`). Never install or switch to Vitest/Jest.
   - Root `/public/` is build output (gitignored). Static source assets belong in `client/public/`.

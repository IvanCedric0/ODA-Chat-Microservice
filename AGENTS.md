# Project Rules & AI Agent Instructions (`oda-chat-service`)

Read this file before modifying any code. Every AI assistant (Copilot, Claude, Codex, Antigravity, Cursor) must strictly obey these boundaries and contracts.

---

## 1. Strict Workspace Boundaries
- **Frontend work (`feat/frontend`):** Work **ONLY** inside `client/`.
  - **NEVER** create, edit, or duplicate backend code in `src/`, `prisma/`, root `package.json`, or `test/`.
  - The Fastify + Prisma + Socket.io backend already lives in `src/` with a layered architecture (`routes/ -> services/ -> repositories/`).
  - Do **NOT** commit `/public/` (it is a Vite build artifact; source static assets live in `client/public/`).
- **Backend work (`feat/backend`):** Work **ONLY** inside `src/`, `prisma/`, and root `package.json`. Do not edit `client/` UI components without coordinating.

---

## 2. Single Source of Truth & `camelCase` Convention
- **Contract files:** [`shared/contracts.ts`](./shared/contracts.ts) and [`CONTRACT.md`](./CONTRACT.md) are the single source of truth for all API & Socket.io contracts.
- **Team convention is `camelCase` everywhere** (this intentionally overrides `snake_case` examples in older PDF docs):
  - **`MessageDTO`:** `{ id, topicId, senderId, content, isDeleted, createdAt }`
  - **`TopicDTO`:** `{ id, serviceName, title, participantIds }`
  - **REST API:**
    - `POST /api/v1/topics` — body: `{ serviceName, title, participantIds }` (auth: `x-service-key`)
    - `POST /api/v1/topics/:topicId/participants` — body: `{ userIds }` (auth: `x-service-key`)
    - `DELETE /api/v1/topics/:topicId/participants/:userId` (auth: `x-service-key`)
    - `GET /api/v1/topics/:topicId/messages?limit=50&beforeId=...` (auth: `Authorization: Bearer <jwt>`)
    - `DELETE /api/v1/messages/:messageId` (auth: `Authorization: Bearer <jwt>`)
  - **Socket.io Events (exact names & payloads from `shared/contracts.ts`):**
    - Client $\rightarrow$ Server: `join_topic({ topicId })`, `send_message({ topicId, content })`, `delete_message({ topicId, messageId })`
    - Server $\rightarrow$ Client: `room_joined({ topicId, history })`, `new_message(MessageDTO)`, `message_deleted({ topicId, messageId })`, `error_event({ code, message })`
- **NEVER** switch fields to `snake_case` (`sender_id`, `created_at`, `before_id`, `message_id`, `user_ids`) or invent new endpoints/events without updating `shared/contracts.ts`.

---

## 3. Widget Security & `postMessage` (`CONTRACT.md`)
- Iframe URL format is `/embed/?topicId=<number>` — **NEVER** pass or read the JWT from URL query parameters.
- Receive the JWT from the host window via `window.postMessage` (`SET_AUTH_TOKEN`, `CHAT_READY`, `SET_ONLINE_USERS`, `CHAT_JOIN`, `CHAT_LEAVE`) with strict origin checking against `VITE_CHAT_PARENT_ORIGINS`.

---

## 4. Tech Stack & Commands
- **Frontend (`client/`):** React 19 + plain JavaScript/JSX (`.jsx`/`.js`, **NO TypeScript** in `client/`), Vite, `socket.io-client`. Use JSDoc types pointing to `../../shared/contracts` where helpful.
  - Verify frontend with: `npm --prefix client run build` and `npm --prefix client run lint`.
- **Backend (`src/`):** Node.js ESM + TypeScript + Fastify 5 + Prisma 7 (`@prisma/adapter-pg`) + Socket.io.
  - Verify backend with: `npm test` (`tsx --test 'src/tests/**/*.test.ts'`) — **NEVER** replace `tsx --test` with Vitest or Jest.

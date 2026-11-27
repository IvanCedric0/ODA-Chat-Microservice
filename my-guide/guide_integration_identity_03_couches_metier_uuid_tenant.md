# Étape 3 — Couches Repositories, Services, Routes & Sockets (UUID + Multi-tenant)

## Objectif
Propager le type `string` (UUID) pour les utilisateurs et le cloisonnement `tenantId` dans toute la logique applicative backend, les schémas Swagger/OpenAPI et Socket.io.

---

## 1. Repositories (`src/repositories/`)

### `src/repositories/topic.repo.ts`
- `createTopicWithParticipants(body: CreateTopicInput)` :
  - Persister `tenantId: body.tenantId` sur `Topic`.
  - Accepter `participantIds: string[]`.
- `findTopicById(id: number, tenantId?: string)` / `findTopicByIdWithParticipants(id: number, tenantId?: string)` :
  - Quand `tenantId` est fourni (requêtes utilisateur et service scopé), filtrer sur `{ id, tenantId }` (ou vérifier `topic.tenantId === tenantId`) pour garantir l'isolation inter-ODC.
- `isParticipant(topicId: number, userId: string)` : typer `userId` en `string`.
- `addParticipants(topicId: number, userIds: string[])` : typer `userIds` en `string[]`.
- `deleteParticipant(topicId: number, userId: string)` : typer `userId` en `string`.

### `src/repositories/message.repo.ts`
- `createMessage(input: CreateMessageInput)` : `senderId: string`.

---

## 2. Services & Mapper (`src/services/`)

### `src/services/mapper.ts`
- `toTopicDTO` : inclure `tenantId: topic.tenantId` et `participantIds: string[]`.
- `toMessageDTO` : `senderId: string`.

### `src/services/topic.service.ts`
- Passer toutes les signatures `userId` / `participants` et le callback `onParticipantRemoved(topicId: number, userId: string)` en `string`.
- Vérifier `tenantId` sur :
  - `createTopic(body)` (`body.tenantId` obligatoire, format UUID).
  - `ensureParticipant(topicId, userId, tenantId)` : si `topic.tenantId !== tenantId`, lever `TOPIC_NOT_FOUND` (évite de révéler l'existence d'un salon d'un autre tenant) ou `FORBIDDEN_CROSS_TENANT`.
  - `getTopicById(topicId, userId, tenantId)`.
  - `addParticipants` / `removeParticipant` : vérifier le `tenantId` si l'appelant fournit un tenant.

### `src/services/message.service.ts`
- Passer `userId` et `senderId` en `string`.
- Mettre à jour `verifyUserTopicParticipation(userId: string, topicId: number, tenantId: string)` pour vérifier à la fois que le topic appartient au bon `tenantId` et que `userId` en est participant.
- Dans `deleteMessage(messageId: number, userId: string, tenantId: string)` : vérifier aussi que le topic du message appartient au `tenantId` de l'utilisateur avant de comparer `message.senderId !== userId`.

---

## 3. Routes REST & Schémas OpenAPI (`src/routes/`)

### `src/routes/topics.routes.ts`
1. **Schémas JSON Schema / Swagger :**
   - `CreateTopic` body : ajouter `tenantId: { type: 'string', format: 'uuid' }` (ou accepter le header `X-Tenant-Id` avec fallback body), et passer `participantIds.items` à `{ type: 'string', format: 'uuid' }`.
   - Réponse `TopicDTO` (`201` et `200`) : ajouter `tenantId: { type: 'string', format: 'uuid' }` et passer `participantIds.items` à `{ type: 'string', format: 'uuid' }`.
   - `POST /:topicId/participants` : `userIds.items` → `{ type: 'string', format: 'uuid' }`.
   - `DELETE /:topicId/participants/:userId` : params `userId` → `{ type: 'string', format: 'uuid' }`.
2. **Handlers :**
   - Sur `DELETE /:topicId/participants/:userId` : supprimer `Number(req.params.userId)` et passer directement `req.params.userId` (`string`).

### `src/routes/messages.routes.ts`
1. **Schémas JSON Schema / Swagger :**
   - `MessageDTO` (`200` sur `GET /topics/:topicId/messages` et `DELETE /messages/:messageId`) : `senderId: { type: 'string', format: 'uuid' }`.
2. **Handlers :**
   - Extraire `{ userId, tenantId } = req.authUser!` et les passer à `messageService.getTopicMessages(...)` et `messageService.deleteMessage(...)`.

---

## 4. Handler Socket.io (`src/sockets/socket.handler.ts`)

- Récupérer `const { userId, tenantId } = socket.data`.
- Passer `tenantId` lors de `join_topic` (`topicService.ensureParticipant(topicId, userId, tenantId)`, `messageService.getTopicMessages(topicId, userId, tenantId, 50)`) et de `send_message` / `delete_message`.
- Mettre à jour `evictUserFromTopic(io, topicId, userId: string)` : la comparaison `s.data.userId === userId` reste exacte en `string`.

---

## Critère de fin de l'étape 3
- `npx tsc --noEmit` passe sans erreur.
- Aucun `Number(userId)` ni `{ type: 'integer' }` pour un `userId` / `senderId` ne subsiste dans `src/`.
- L'isolation par `tenantId` est appliquée sur REST et Socket.io.

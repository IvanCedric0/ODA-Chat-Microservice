# Étape 1 — Contrats partagés & Modèle de données (UUID + Multi-tenant)

## Objectif
Faire passer tous les identifiants utilisateurs (`userId`, `senderId`, `participantIds`, `userIds`) de `number`/`Int` à `string` (**UUID v4**, format émis par `identity`) et ajouter l'isolation par établissement (`tenantId`).

---

## 1. Contrats partagés (`shared/contracts.ts` et `CONTRACT.md`)

### Fichiers concernés
- `shared/contracts.ts`
- `CONTRACT.md`

### Modifications à appliquer
1. **Conserver `id` et `topicId` en `number`** (identifiants internes du microservice chat) — seuls les identifiants issus d'`identity` passent en `string`.
2. **Passer les identifiants utilisateurs en `string` (UUID) :**
   - `MessageDTO.senderId`: `number` → `string`
   - `TopicDTO.participantIds`: `number[]` → `string[]`
   - `CreateTopicInput.participantIds`: `number[]` → `string[]`
   - `CreateMessageInput.senderId`: `number` → `string`
3. **Ajouter le `tenantId` (multi-tenant) :**
   - `TopicDTO.tenantId`: `string`
   - `CreateTopicInput.tenantId`: `string` (ou fourni via le corps / header `X-Tenant-Id` selon le choix API sur `POST /api/v1/topics` — documenter clairement dans `CONTRACT.md`).
4. **Mettre à jour `CONTRACT.md`** :
   - Exemples JSON REST et Socket.io avec des UUID (ex. `"550e8400-e29b-41d4-a716-446655440000"`).
   - Documenter `tenantId` sur la création et la réponse d'un topic.
   - Documenter le préfixe `/api/chat` (voir Étape 4).

---

## 2. Schéma PostgreSQL (`prisma/schema.prisma`)

### Fichier concerné
- `prisma/schema.prisma`

### Modifications à appliquer
1. **Sur `Topic` :**
   - Ajouter `tenantId String @map("tenant_id") @db.Uuid` (ou nullable temporairement si vous avez des données dev existantes, mais en base propre `String @db.Uuid` est plus sûr).
   - Remplacer/compléter `@@index([serviceName])` par `@@index([tenantId, serviceName])`.
2. **Sur `TopicParticipant` :**
   - Changer `userId Int @map("user_id")` → `userId String @map("user_id") @db.Uuid`.
   - Conserver `@@id([topicId, userId])` et `@@index([userId])`.
3. **Sur `Message` :**
   - Changer `senderId Int @map("sender_id")` → `senderId String @map("sender_id") @db.Uuid`.
   - Conserver `id BigInt @id @default(autoincrement())` et `@@index([topicId, id(sort: Desc)])`.

---

## 3. Migrations & Client Prisma

### Commandes à prévoir lors de l'implémentation
1. Créer la migration (en base dev propre ou avec stratégie de reset si données de test uniquement) :
   ```bash
   npx prisma migrate dev --name uuid_users_and_tenant_isolation
   ```
2. Régénérer le client Prisma dans `src/generated/prisma` :
   ```bash
   npx prisma generate
   ```

---

## Critère de fin de l'étape 1
- `shared/contracts.ts` et `CONTRACT.md` décrivent tous les identifiants utilisateurs en `string` (UUID) et incluent `tenantId`.
- `prisma/schema.prisma` compile sans erreur et la migration s'applique proprement sur PostgreSQL (y compris avec `?schema=chat`).

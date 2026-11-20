# Guide d'Implémentation Backend — Micro-service Chat

Ce guide structure votre feuille de route sur la partie serveur (**Node.js, TypeScript, Fastify, Socket.io, Prisma, PostgreSQL**). L'objectif n'est pas de copier-coller une solution, mais de comprendre chaque brique en appliquant une architecture en couches légère (**Routes / Sockets $\rightarrow$ Services $\rightarrow$ Repositories**).

---

## 1. Business Explanation (Pourquoi ce service existe ?)

Dans une plateforme modulaire (Forum, Streaming, E-learning), chaque module a besoin d'un espace de discussion privé sans avoir à réinventer la messagerie temps réel.

* **Votre mission :** Fournir une boîte noire autonome capable de créer des salons privés (*Topics*), de contrôler qui a le droit d'y entrer, de diffuser instantanément les messages et de conserver l'historique.
* **Ce que vous ne faites pas :** Vous ne gérez ni l'inscription, ni les mots de passe, ni les noms/avatars des utilisateurs. Le service externe `Identity` est l'unique source de vérité pour les comptes ; votre service manipule uniquement des identifiants numériques (`userId`).

---

## 2. Architecture Explanation (Comment le code est organisé ?)

Pour garder un code lisible, maintenable et facile à tester sans tomber dans la sur-ingénierie (pas de classes abstraites complexes ni d'injection de dépendances lourde), découpez `src/` en trois responsabilités strictes :

```text
src/
├── config/          # Configuration globale (variables d'env validées, singleton Prisma)
├── repositories/    # Accès pur à PostgreSQL via Prisma (aucune règle métier)
├── services/        # Règles métier et permissions (indépendant de HTTP ou WebSocket)
├── routes/          # Adaptateur HTTP Fastify (validation JSON, codes 200/201/403/404)
├── sockets/         # Adaptateur Temps Réel Socket.io (handshake JWT, rooms, broadcasts)
└── server.ts        # Point d'assemblage (Fastify + Swagger + Static + Socket.io)
```

### Le flux d'une donnée :
1. **Transport (`routes/` ou `sockets/`)** : Reçoit la requête réseau, vérifie l'authenticité du jeton JWT et extrait les paramètres.
2. **Service (`services/`)** : Vérifie les règles métier (*« Le salon existe-t-il ? »*, *« L'utilisateur est-il membre ? »*, *« Est-il l'auteur du message qu'il veut supprimer ? »*). Lève des erreurs métier explicites (ex. `FORBIDDEN`, `NOT_FOUND`).
3. **Repository (`repositories/`)** : Exécute la requête Prisma correspondante et retourne la donnée brute.

---

## 3. Implementation (Feuille de route par étapes)

### Étape 1 : Infrastructure & Base de données (`docker-compose.yml` & `prisma/schema.prisma`)
* **Objectif :** Isoler PostgreSQL dans un conteneur reproductible et définir les 3 tables (`Topic`, `TopicParticipant`, `Message`).
* **Indices & Directions :**
  * Utilisez le port hôte `5433:5432` dans `docker-compose.yml` pour éviter tout conflit avec un PostgreSQL déjà installé localement.
  * Dans `schema.prisma`, utilisez `@@id([topicId, userId])` sur `TopicParticipant` pour empêcher naturellement les doublons de membres dans un même salon.
  * Ajoutez un index composé `@@index([topicId, createdAt(sort: Desc)])` sur `Message` afin d'accélérer le chargement des derniers messages.
  * Générez la migration avec `npx prisma migrate dev --name init`.

### Étape 2 : Configuration & Contrat Partagé (`src/config/` & `shared/contracts.ts`)
* **Objectif :** Centraliser la connexion DB et verrouiller les formats d'échange avec le frontend.
* **Indices & Directions :**
  * **`src/config/env.ts`** : Lisez `process.env` au démarrage et faites échouer le programme immédiatement si `DATABASE_URL` ou `JWT_SECRET` est absent.
  * **`src/config/prisma.ts`** : Exportez une instance unique (`export const prisma = new PrismaClient()`). Ne faites jamais `new PrismaClient()` dans vos repositories.
  * **`shared/contracts.ts`** : Définissez `MessageDTO`, `TopicDTO`, ainsi que les interfaces d'événements `ClientToServerEvents` et `ServerToClientEvents` pour typer votre instance Socket.io.

### Étape 3 : Couche Repositories (`src/repositories/`)
* **Objectif :** Isoler toutes les requêtes Prisma dans `topic.repo.ts` et `message.repo.ts`.
* **Indices & Directions :**
  * Un repository ne contient **aucun `if` métier** et ne connaît pas Fastify.
  * **`topic.repo.ts`** : Préparez des fonctions atomiques comme `createTopicWithParticipants(...)` (utilisez les écritures imbriquées de Prisma `participants: { create: ... }` pour garantir une transaction SQL), `findTopicById(id)`, `isParticipant(topicId, userId)`, `addParticipants(...)` et `removeParticipant(...)`.
  * **`message.repo.ts`** : Préparez `createMessage(...)`, `findMessagesByTopic(topicId, limit, beforeId)` et `softDeleteMessage(messageId)` (qui met `isDeleted: true` sans supprimer la ligne SQL).
  * *Astuce Prisma :* Gérez l'erreur `P2002` (violation de contrainte unique) lors de l'ajout d'un participant déjà présent.

### Étape 4 : Couche Services (`src/services/`)
* **Objectif :** Implémenter la logique métier et la sécurité applicative.
* **Indices & Directions :**
  * **`auth.service.ts`** : Vérifiez la signature du JWT avec `jsonwebtoken` et retournez le `userId` extrait. Aucune requête réseau vers `Identity` n'est nécessaire ici (validation *stateless*).
  * **`topic.service.ts` & `message.service.ts`** : Passez le repository en paramètre par défaut (ex. `repo = topicRepo`) pour faciliter les tests unitaires.
  * Avant d'autoriser la lecture d'historique ou l'envoi d'un message, appelez systématiquement la vérification d'appartenance au salon.
  * Pour la suppression d'un message, vérifiez que `message.senderId === currentUserId` avant d'appeler le repository.

### Étape 5 : Adaptateurs HTTP & Temps Réel (`src/routes/`, `src/sockets/`, `src/server.ts`)
* **Objectif :** Exposer les fonctionnalités sur le réseau.
* **Indices & Directions :**
  * **`GET /health`** : Créez une route de santé qui exécute `await prisma.$queryRaw\`SELECT 1\`` pour prouver que l'API et la base répondent.
  * **Routes REST (`src/routes/`)** : Ajoutez des schémas JSON sur vos routes Fastify ; `@fastify/swagger` générera automatiquement la documentation sur `/docs`.
  * **Middleware Socket.io (`src/sockets/socket.auth.ts`)** : Interceptez la connexion via `io.use(...)`, lisez `socket.handshake.auth.token`, vérifiez le JWT et stockez l'ID dans `socket.data.userId`.
  * **Gestionnaire d'événements (`src/sockets/chat.handler.ts`)** :
    * Sur `join_topic` : vérifiez l'accès via `topicService`, puis appelez `socket.join(\`topic_${topicId}\`)` et renvoyez l'historique récent (`room_joined`).
    * Sur `send_message` : persistez via `messageService` puis diffusez avec `io.to(\`topic_${topicId}\`).emit('new_message', dto)`.
  * **Serveur statique (`src/server.ts`)** : Servez le dossier `public/` sous le préfixe `/embed/` via `@fastify/static` et configurez l'en-tête `Content-Security-Policy: frame-ancestors ...` pour autoriser l'intégration en `<iframe>`.

---

## 4. Tests (Validation de la robustesse)

1. **Tests Unitaires des Services (Sans base de données) :**
   * Utilisez `node:test` ou `vitest`.
   * Passez un faux objet `repo` en argument de vos fonctions de service pour tester rapidement les cas limites : tentative d'accès à un salon inexistant, envoi d'un message par un non-membre, tentative de suppression du message d'un autre utilisateur.
2. **Tests d'Intégration API & Socket.io :**
   * Utilisez la méthode `fastify.inject(...)` pour tester vos routes HTTP (`POST /api/v1/topics`, `GET /health`) sans même ouvrir de port réseau.
   * Testez avec `socket.io-client` qu'un utilisateur non inscrit dans `topic_participants` reçoit bien un événement d'erreur lorsqu'il tente `join_topic`.

---

## 5. Key Decisions (Décisions d'architecture à maîtriser)

* **Pourquoi le pattern Repository léger ?** Il sépare les requêtes SQL/Prisma des règles métier. Si vous changez une requête Prisma ou si vous écrivez un test unitaire, vous n'avez pas besoin de toucher aux règles de permissions ni aux routes HTTP.
* **Pourquoi la validation JWT est-elle locale (*stateless*) ?** Appeler le service `Identity` à chaque message créerait un goulot d'étranglement réseau. Vérifier la signature cryptographique localement garantit une latence minimale et une résilience même si `Identity` ralentit.
* **Pourquoi le *Soft-Delete* (`isDeleted = true`) ?** Préserve l'intégrité chronologique de la conversation et permet aux clients connectés de remplacer dynamiquement le texte par *« Ce message a été supprimé »*.

---

## 6. Verify (Comment vérifier votre travail ?)

1. Lancez `docker compose up -d` puis `npm run dev`.
2. Ouvrez `http://localhost:3000/docs` (Swagger UI) :
   * Testez `GET /health` $\rightarrow$ doit retourner `200 OK`.
   * Exécutez `POST /api/v1/topics` avec `participant_ids: [10, 24]` $\rightarrow$ vérifiez dans pgAdmin (connecté sur `localhost:5433`) que les lignes sont créées dans `topics` et `topic_participants`.
3. Générez des jetons de test avec `npm run tokens` et vérifiez qu'une connexion Socket.io avec l'utilisateur `10` rejoint le salon `1`, tandis que l'utilisateur `35` est rejeté.

---

## 7. Review Checklist (Avant de valider la PR)

- [ ] Aucun secret (`JWT_SECRET`, `DATABASE_URL`) n'est écrit en dur dans le code ou commité dans Git.
- [ ] Les repositories ne contiennent aucune logique HTTP ni règle d'autorisation.
- [ ] Les services ne dépendent ni de `FastifyRequest` ni de `Socket`.
- [ ] Le `senderId` d'un message provient uniquement de `socket.data.userId` (jamais du payload client).
- [ ] Les erreurs Prisma courantes (salon introuvable, membre déjà ajouté `P2002`) retournent des codes HTTP/Socket propres et non des erreurs `500`.
- [ ] `npm run build` compile le TypeScript sans aucune erreur de typage.
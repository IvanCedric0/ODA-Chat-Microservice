# Étape 7 — Scripts de dev, Suite de tests & Vérification

## Objectif
Mettre à jour les scripts et toute la pyramide de tests (`step1` → `step5`) pour couvrir les UUID, l'isolation multi-tenant, la validation RS256 + JWKS et le montage `BASE_PATH=/api/chat`.

---

## 1. Script `src/scripts/dev-tokens.ts`

- Remplacer les IDs numériques `[10, 24, 35]` par des UUID de test explicites.
- Supporter :
  - Génération de tokens de test signés en **RS256** (avec une paire RSA de dev locale + `kid`, `iss`, `aud`, `tid`, `sid`, `membership: 'ACADEMICIAN'`, `token_use: 'access'`), **ou**
  - Documentation d'utilisation directe des tokens obtenus via `identity` (`/oauth/token`).
- Aligner l'affichage avec le protocole sécurisé actuel (`postMessage` via `host-preview.html` plutôt que `?token=` dans l'URL).

---

## 2. Mise à jour des tests backend (`src/tests/`)

### `src/tests/step1-step2.test.ts` & `src/tests/step3-repos.test.ts`
- Adapter les fixtures `Topic`, `TopicParticipant`, `Message` aux `userId` / `senderId` **UUID** et à `tenantId`.
- Ajouter des cas de test sur l'isolation multi-tenant dans `TopicRepository` (un `topic` du `tenantA` n'est pas retourné si filtré pour `tenantB`).

### `src/tests/step4-services.test.ts`
- Adapter les mocks de `topicService` et `messageService` aux `userId` UUID + `tenantId`.
- Tester le blocage cross-tenant (`FORBIDDEN` / `TOPIC_NOT_FOUND` quand un utilisateur du tenant B tente d'accéder à un salon du tenant A).
- Tester `auth.service.ts` avec une **clé RSA générée en mémoire via `jose`** + mini serveur HTTP JWKS local (port éphémère) :
  - Token RS256 valide (`token_use: 'access'`, `membership: 'ACADEMICIAN'`, `tid` UUID) → accepté.
  - Mauvais `iss` ou `aud` → rejeté.
  - Token `client_credentials` (`sub === client_id`) → rejeté.
  - Compte `membership: 'VISITOR'` → rejeté.
  - Rotation de `kid` sur le JWKS mock → rechargement automatique et validation réussie.

### `src/tests/step5-api-socket.test.ts`
- Passer les appels REST (`POST /api/v1/topics`, `.../participants`, `GET .../messages`, `DELETE /api/v1/messages/:id`) et les connexions Socket.io sur des tokens RS256 + JWKS de test avec UUIDs et `tenantId`.
- Ajouter des assertions sur :
  - `403` (ou `401`) sur un token `VISITOR` en REST et rejet au handshake Socket.io.
  - Rejet d'un accès cross-tenant entre deux utilisateurs de tenants différents.
  - Montage complet avec `BASE_PATH=/api/chat` (`/api/chat/health`, `/api/chat/embed/`, `/api/chat/api/v1/...`, `/api/chat/socket.io`).
  - *(Si Étape 6 implémentée)* Déconnexion d'un socket actif lors de la réception d'un événement `identity.session_revoked` / `identity.user_disabled`.

---

## 3. Commandes de validation finale

Toujours vérifier après la dernière modification :
```bash
npm test
npm run build
npm --prefix client run lint
```
*(Et si Docker `odc-campus` est lancé : tester un flux réel complet avec un `access_token` émis par `identity` sur `http://localhost/api/identity/oauth/token` puis appel à `http://localhost/api/chat/...`.)*

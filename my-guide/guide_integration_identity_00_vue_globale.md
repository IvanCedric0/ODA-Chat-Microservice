# Intégration ODC Campus & Identity — Vue globale

Ce dossier complète les guides initiaux (`guide_d_impl_mentation_*`) pour raccorder **`oda-chat-service`** à la plateforme **ODC Campus** et à son microservice **`identity`**.

---

## 1. Décisions d'architecture retenues

1. **Isolation multi-tenant (`Topic.tenantId`) :**
   - Chaque salon (`Topic`) porte l'identifiant d'établissement `tenantId` (`UUID`, issu de la claim `tid` du JWT utilisateur ou du contexte appelant côté service-à-service).
   - Un utilisateur d'un ODC ne peut jamais lire, rejoindre ni poster dans un salon d'un autre ODC.
2. **Préfixe unique derrière Traefik (`BASE_PATH=/api/chat`) :**
   - Comme `identity` (`/api/identity`), `attendance` (`/api/attendance`), `tasks` (`/api/tasks`) ou `evaluation` (`/api/evaluation`), Traefik route par `PathPrefix(\`/api/chat\`)` **sans `stripPrefix`**.
   - Le service monte toutes ses routes (REST, widget `/embed/`, Socket.io, Swagger `/docs`, `/health`) sous `BASE_PATH`.
3. **Décision 3 — Stratégie de vérification JWT en mode solo / tests (retenue : Option A) :**
   - **Option A (retenue) :** mode **JWKS RS256** par défaut dès que `JWT_JWKS_URL` est défini (et obligatoire en production), avec **fallback HS256 (`JWT_SECRET`)** uniquement hors production si `JWT_JWKS_URL` est absent, **et** génération d'une paire RSA éphémère (`jose`) dans la suite de tests automatisés.
   - *(Rappel sur `client/` : les adaptations du widget frontend seront faites sur cette même branche `feat/integrate-identity`, mais **après** la finalisation des modifications backend.)*

---

## 2. Écarts principaux entre l'état actuel et ODC Campus

| Sujet | État actuel (`oda-chat-service`) | Cible (`odc-campus` / `identity`) |
|---|---|---|
| Signature JWT | Symétrique `HS256` (`JWT_SECRET`, `jsonwebtoken`) | Asymétrique `RS256` + JWKS (`jose`, `JWT_JWKS_URL`) |
| Validation JWT | Synchrone (`verifyJwtToken`) | Asynchrone (`createRemoteJWKSet` + `jwtVerify`) |
| Type `userId` / `senderId` | `Int` (PostgreSQL) / `number` | `UUID` (`String @db.Uuid` / `string`) |
| Isolation ODC | Aucune (`serviceName` uniquement) | `tenantId` (`tid` du JWT, `UUID`) |
| Contrôle d'accès token | `sub ?? userId` numérique | Rejet `client_credentials` (`sub === client_id`) et `VISITOR` (`membership`) |
| Routage réseau | Racine `/`, `/api/v1/...`, `/embed/`, `/socket.io` | Préfixé par `BASE_PATH=/api/chat` derrière Traefik |
| Révocation temps réel | Aucune (expiration JWT) | Écoute RabbitMQ (`identity.session_revoked`, `identity.user_disabled`, `identity.user_membership_changed`) |
| Base PostgreSQL | Base dédiée locale | Instance partagée `odc_campus`, schéma isolé `?schema=chat` |

---

## 3. Ordre des étapes (fichiers du dossier)

1. [guide_integration_identity_01_contrats_et_bdd.md](./guide_integration_identity_01_contrats_et_bdd.md) — Contrats `shared/contracts.ts`, `CONTRACT.md` et migration Prisma (`UUID` + `tenantId`).
2. [guide_integration_identity_02_auth_jwks.md](./guide_integration_identity_02_auth_jwks.md) — Config `env.ts`, vérification `RS256` + JWKS (`jose`), hooks HTTP et handshake Socket.io.
3. [guide_integration_identity_03_couches_metier_uuid_tenant.md](./guide_integration_identity_03_couches_metier_uuid_tenant.md) — Adaptation `repositories/`, `services/`, `routes/` (OpenAPI) et `sockets/` aux UUID et au cloisonnement par `tenantId`.
4. [guide_integration_identity_04_routage_traefik_base_path.md](./guide_integration_identity_04_routage_traefik_base_path.md) — Montage `BASE_PATH=/api/chat` dans `server.ts`, CORS, CSP `frame-ancestors` et Socket.io.
5. [guide_integration_identity_05_widget_frontend.md](./guide_integration_identity_05_widget_frontend.md) — Coordination `client/` (UUIDs, `postMessage`, `VITE_API_BASE_PATH` / `VITE_SOCKET_PATH`, Vite).
6. [guide_integration_identity_06_rabbitmq_et_docker.md](./guide_integration_identity_06_rabbitmq_et_docker.md) — Consumer RabbitMQ (`odc.events`), `Dockerfile` et intégration `odc-campus/platform`.
7. [guide_integration_identity_07_scripts_et_tests.md](./guide_integration_identity_07_scripts_et_tests.md) — `dev-tokens.ts`, adaptation des tests `step1`–`step5` et vérification complète.

---

## 4. Rappel des limites de branche (`AGENTS.md`)

- `shared/contracts.ts` et `CONTRACT.md` restent la **source de vérité unique** (toujours en `camelCase`).
- Tout changement dans `client/` doit être coordonné avec l'équipe/branche frontend (`feat/frontend`) ou explicitement validé avant modification.

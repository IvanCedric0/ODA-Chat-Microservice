# Étape 6 — Bus RabbitMQ & Intégration Infrastructure `odc-campus`

## Objectif
1. Réagir en temps réel aux événements de sécurité publiés par `identity` sur RabbitMQ.
2. Intégrer `oda-chat-service` dans l'infrastructure Docker Compose / PostgreSQL / Traefik d'`odc-campus`.

---

## 1. Consommation RabbitMQ (coupure immédiate des WebSockets)

### Contexte `identity`
Les access tokens d'`identity` ont un TTL de 15 minutes et restent valides cryptographiquement jusqu'à `exp`. Pour couper immédiatement un utilisateur déconnecté ou désactivé sur un salon WebSocket déjà ouvert, `identity` publie sur l'exchange topic **`odc.events`** :
- `identity.session_revoked` → `payload: { session_id, user_id, reason, client_ids }`
- `identity.user_disabled` → `payload: { user_id }`
- `identity.user_membership_changed` → `payload: { user_id, membership, previous_membership }`

### Implémentation côté `oda-chat-service`
1. Ajouter `amqplib` (et `@types/amqplib` en dev) dans `package.json`.
2. Créer un module léger `src/events/identity-events.consumer.ts` (actif uniquement si `RABBITMQ_URL` est défini — non bloquant en mode solo/test) :
   - Se connecter à `env.rabbitmqUrl`, déclarer l'exchange topic durable `odc.events`.
   - Déclarer une queue durable dédiée `chat.identity-events` et la lier aux routing keys :
     - `identity.session_revoked`
     - `identity.user_disabled`
     - `identity.user_membership_changed`
   - Traiter chaque message (enveloppe `envelope.schema.json`) :
     - Sur `identity.session_revoked` : déconnecter (`socket.disconnect(true)`) tous les sockets connectés où `socket.data.sessionId === event.payload.session_id` (en émettant d'abord `error_event` `SESSION_REVOKED`).
     - Sur `identity.user_disabled` : déconnecter tous les sockets où `socket.data.userId === event.payload.user_id`.
     - Sur `identity.user_membership_changed` si `event.payload.membership === 'VISITOR'` : déconnecter tous les sockets de `event.payload.user_id`.
3. Fermer proprement le channel/connexion RabbitMQ dans le hook `fastify.addHook('onClose', ...)` de `src/server.ts`.

---

## 2. Conteneurisation (`Dockerfile` dans `oda-chat-service`)

Créer un `Dockerfile` multi-stage :
1. Build du widget `client/` (`VITE_WIDGET_BASE=/api/chat/embed/`, `VITE_API_BASE_PATH=/api/chat`, `VITE_SOCKET_PATH=/api/chat/socket.io`, `VITE_CHAT_PARENT_ORIGINS=http://localhost`).
2. Build TypeScript backend (`tsc`) + `npx prisma generate`.
3. Image finale Node.js 22 Alpine exécutant `npx prisma migrate deploy && node dist/src/server.js`.

---

## 3. Raccordement côté `odc-campus/platform` *(à coordonner avec le repo parent)*

1. **Base PostgreSQL (`odc-campus/platform/postgres/init.sql`) :**
   - Ajouter `CREATE SCHEMA IF NOT EXISTS chat;`
2. **Service Compose (`odc-campus/platform/docker-compose.yml`) :**
   - Port interne `4006` (après `identity:4001`, `notification:4002`, `attendance:4003`, `tasks:4004`, `evaluation:4005`).
   - Variables d'environnement principales :
     - `DATABASE_URL: postgresql://odc:odc@postgres:5432/odc_campus?schema=chat`
     - `BASE_PATH: /api/chat`
     - `JWT_JWKS_URL: http://identity:4001/api/identity/.well-known/jwks.json`
     - `JWT_ISSUER: http://localhost/api/identity`
     - `JWT_AUDIENCE: odc-campus`
     - `RABBITMQ_URL: amqp://rabbitmq:5672`
     - `ALLOWED_ORIGINS: http://localhost`
   - Labels Traefik :
     - `traefik.enable=true`
     - `traefik.http.routers.chat.rule=PathPrefix(\`/api/chat\`)`
     - `traefik.http.services.chat.loadbalancer.server.port=4006`
   - Dépendances : `postgres` (healthy), `identity` (healthy), `rabbitmq` (healthy).

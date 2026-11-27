# Étape 4 — Routage Traefik (`BASE_PATH=/api/chat`) & Serveur Fastify

## Objectif
Adapter `src/server.ts` pour fonctionner derrière la gateway **Traefik** d'ODC Campus sous le préfixe `/api/chat` (sans réécriture d'URL / `stripPrefix`), tout en restant testable à la racine quand `BASE_PATH=""`.

---

## 1. Convention Traefik dans ODC Campus

Dans `odc-campus/platform/docker-compose.yml` :
- Traefik route par `PathPrefix(\`/api/chat\`)` vers le conteneur chat **sans supprimer le préfixe** (même modèle que `identity` avec `BASE_PATH=/api/identity`).
- L'application doit donc exposer toutes ses routes sous `${base}` (`env.basePath`, ex. `/api/chat`).

---

## 2. Montage des plugins dans `src/server.ts`

Soit `const base = env.basePath` (`''` ou `'/api/chat'`). Mettre à jour :

1. **Routes REST :**
   - `topicRoutes` : prefix `` `${base}/api/v1/topics` ``
   - `messageRoutes` : prefix `` `${base}/api/v1` ``
   - `healthRoutes` : prefix `base || undefined` (et optionnellement garder aussi `/health` à la racine pour le `healthcheck` interne Docker).
2. **Widget statique (`/embed/`) & CSP `frame-ancestors` :**
   - `@fastify/static` : `prefix: `${base}/embed/``
   - Hook `onSend` : tester ``request.url.startsWith(`${base}/embed`)`` pour poser l'en-tête `Content-Security-Policy: frame-ancestors ...`.
3. **Documentation Swagger UI :**
   - `@fastify/swagger-ui` : `routePrefix: `${base}/docs``
   - Optionnel : renseigner `openapi.servers: [{ url: base || '/' }]` pour que le bouton *Try it out* de Swagger fonctionne derrière Traefik.
4. **Socket.io :**
   - Passer `path: `${base}/socket.io`` dans `new Server(fastify.server, { path: ..., cors: ... })`.
   - En mode solo (`BASE_PATH=""`), `path` reste `/socket.io` (comportement inchangé).
   - Derrière Traefik (`BASE_PATH=/api/chat`), Socket.io répond sur `/api/chat/socket.io/`.

---

## 3. CORS & `frame-ancestors` (`ALLOWED_ORIGINS`)

- Vérifier que `ALLOWED_ORIGINS` inclut l'origine Traefik (`http://localhost`) en plus des origines front des services ODC Campus (ex. console admin `http://localhost:5173`, apps hôtes).
- Conserver `credentials: true` sur `@fastify/cors` et Socket.io.

---

## Critère de fin de l'étape 4
- Avec `BASE_PATH=/api/chat` :
  - `GET http://localhost/api/chat/health` → `200`
  - `GET http://localhost/api/chat/embed/?topicId=1` → `200` avec CSP `frame-ancestors`
  - `GET http://localhost/api/chat/docs` → Swagger UI fonctionnel
  - Handshake WebSocket sur `path: '/api/chat/socket.io'` → connecté.
- Avec `BASE_PATH=""` : tout continue de répondre aux chemins historiques (`/health`, `/embed/`, `/api/v1/...`, `/socket.io`).

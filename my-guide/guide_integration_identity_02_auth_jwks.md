# Étape 2 — Authentification RS256 + JWKS & Claims `identity`

## Objectif
Remplacer la vérification symétrique `HS256` (`JWT_SECRET`) par la vérification asymétrique **RS256 via JWKS** d'`identity`, et appliquer les règles d'autorisation ODC Campus (`iss`, `aud`, `token_use`, `tid`, `membership`, rejet `client_credentials`).

---

## 1. Dépendances (`package.json`)

- Installer **`jose`** (même bibliothèque que `odc-campus/services/identity` pour `createRemoteJWKSet` et `jwtVerify`).
- Selon la Décision 3 :
  - Si **Option A (fallback dev)** : garder `jsonwebtoken` uniquement en `devDependencies` (ou en fallback hors prod).
  - Si **Option B (full JWKS)** : retirer `jsonwebtoken` et `@types/jsonwebtoken`.

---

## 2. Variables d'environnement (`src/config/env.ts`)

Ajouter et valider :
- `BASE_PATH` (défaut `''`, normalisé sans `/` final, ex. `/api/chat`).
- `JWT_JWKS_URL` (optionnel en dev si fallback HS256 autorisé, **obligatoire en production**, ex. `http://identity:4001/api/identity/.well-known/jwks.json`).
- `JWT_ISSUER` (ex. `http://localhost/api/identity`).
- `JWT_AUDIENCE` (défaut `'odc-campus'`).
- `JWT_SECRET` : devient optionnel dès lors que `JWT_JWKS_URL` est défini.
- `RABBITMQ_URL` (optionnel, utilisé à l'Étape 6) et `RABBITMQ_EXCHANGE` (défaut `'odc.events'`).

> Penser à mettre à jour `.env.example` (sans jamais commiter `.env`).

---

## 3. Service d'authentification (`src/services/auth.service.ts`)

### Contrat du contexte utilisateur extrait
Définir une interface `AuthenticatedUser` (au lieu d'un simple `number`) :
```ts
export interface AuthenticatedUser {
  userId: string;      // payload.sub (UUID)
  tenantId: string;    // payload.tid (UUID)
  tenantSlug?: string; // payload.tenant
  sessionId?: string;  // payload.sid (UUID, utile pour révocation)
  roles: string[];
  perms: string[];
  membership?: string; // 'ACADEMICIAN' | 'VISITOR'
  isPlatformAdmin: boolean; // Boolean(payload.pfa)
}
```

### Règles de vérification (`verifyJwtToken` → asynchrone)
1. **Vérification cryptographique (`jose`) :**
   - Initialiser `createRemoteJWKSet(new URL(env.jwtJwksUrl))` (cache en mémoire + rechargement automatique si un nouveau `kid` apparaît).
   - Appeler `jwtVerify(token, jwks, { issuer: env.jwtIssuer, audience: env.jwtAudience, algorithms: ['RS256'], typ: 'at+jwt' })`.
   - *(Note : vérifier si des tokens de démo/tests omettent `typ` ; au minimum vérifier `payload.token_use === 'access'`.)*
2. **Contrôles métier `identity` :**
   - Rejeter si `payload.token_use !== 'access'`.
   - Rejeter les tokens machine `client_credentials` : si `!payload.sub || payload.sub === payload.client_id`.
   - Valider le format UUID de `payload.sub` et de `payload.tid` (un utilisateur doit être rattaché à un tenant).
   - **Bloquer les `VISITOR` :** si `payload.membership === 'VISITOR' && !payload.pfa`, refuser l'accès (`FORBIDDEN_VISITOR` ou `403`/`401` selon le contexte).
3. **Adaptation des helpers :**
   - `verifyUserToken(authHeader?: string): Promise<AuthenticatedUser>`
   - `verifyServiceKey(apiKeyHeader?: string | string[]): void` reste inchangé pour `x-service-key` *(ou peut être complété plus tard par un flux `client_credentials` si les autres services de la plateforme l'utilisent)*.

---

## 4. Hooks Fastify & Handshake Socket.io

### `src/hooks/auth.hooks.ts`
- Étendre `FastifyRequest` avec :
  - `userId?: string`
  - `authUser?: AuthenticatedUser`
- Passer `requireUserAuth` avec `await verifyUserToken(request.headers.authorization)` et gérer distinctement :
  - Token absent/invalide → `401`
  - Compte `VISITOR` → `403` (recommandé pour refléter le comportement d'`identity`)

### `src/sockets/socket.auth.ts`
- Passer `socketAuthMiddleware` en `async` (`await verifyJwtToken(token)`).
- Mettre à jour `SocketData` :
  - `userId: string`
  - `tenantId: string`
  - `sessionId?: string`
- Refuser la connexion Socket.io avec une erreur explicite (`Unauthorized: ...` ou `Forbidden: VISITOR account`) si le token est rejeté.

---

## Critère de fin de l'étape 2
- Un JWT `RS256` émis par `identity` est validé localement via JWKS sans appel synchrone à `identity`.
- Un token expiré, falsifié, `client_credentials` ou appartenant à un `VISITOR` est rejeté autant en HTTP qu'au handshake Socket.io.

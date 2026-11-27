# Étape 5 — Coordination Widget Frontend (`client/`)

> **Rappel (`AGENTS.md`) :** cette étape touche `client/` (React 19 + JS/JSX, **sans TypeScript**). À coordonner avec la branche/équipe frontend (`feat/frontend`) avant édition.

## Objectif
Rendre le widget `/embed/` compatible avec les **UUID** d'`identity` et avec le préfixe **`/api/chat`** derrière Traefik.

---

## 1. Identifiants utilisateurs UUID dans le widget

### `client/src/components/Chat.jsx`
- Ligne 41 : remplacer `const authUserId = Number(authPayload.sub ?? authPayload.userId)` par une lecture chaîne :
  ```js
  const rawUserId = authPayload.sub ?? authPayload.userId;
  const authUserId = typeof rawUserId === 'string' && rawUserId.trim() ? rawUserId.trim() : '';
  ```
- Dans `notifyHostPresence` (ligne 79) : remplacer `Number.isInteger(authUserId)` par `Boolean(authUserId)`.
- Vérifier les comparaisons `message.senderId === authUserId` (dans `Chat.jsx` / `MessageList.jsx` / `messageMapper.js`) : les deux côtés étant désormais des `string` UUID, la comparaison stricte `===` reste sûre.

### `client/src/lib/chatAuth.js`
- Dans `getTrustedOnlineUsers` (lignes 63-64) : remplacer la validation `!Number.isInteger(user.id) || user.id <= 0` par une validation `typeof user.id === 'string' && user.id.trim().length > 0` (et éventuellement regex UUID).

### `client/src/lib/socket.js`
- Dans `sendChatMessage` (ligne 23) : remplacer `!Number.isInteger(senderId)` par `typeof senderId !== 'string' || !senderId.trim()`.

### `client/src/hostPreview.js`
- Dans l'écouteur `message` (`CHAT_JOIN` / `CHAT_LEAVE`, ligne 84) et `BroadcastChannel` : valider `userId` comme `string` non vide au lieu de `Number.isInteger(userId) && userId > 0`.
- Mettre à jour l'exemple JSON de présence par défaut dans `host-preview.html` / `hostPreview.js` avec des UUID.

---

## 2. Support de `BASE_PATH=/api/chat` côté build & runtime

### `client/vite.config.js`
- Rendre `base` configurable via variable d'environnement au build Vite (ex. `VITE_WIDGET_BASE=/api/chat/embed/` avec défaut `'/embed/'`), et mettre à jour les règles `server.proxy` si besoin en dev.

### Appels REST et Socket.io dans `client/`
- **Appels `fetch('/api/v1/...')`** dans `Chat.jsx` (chargement/pagination d'historique, suppression de message) : préfixer par `VITE_API_BASE_PATH` (défaut `''`, valeur Docker `'/api/chat'`).
- **`createChatSocket` (`client/src/lib/socket.js`)** : passer `path: import.meta.env.VITE_SOCKET_PATH || '/socket.io'` à `io({ path, auth: { token, topicId }, autoConnect: false })`.
- **`VITE_CHAT_PARENT_ORIGINS`** : inclure `http://localhost` (origine Traefik) et les URLs des fronts ODC Campus autorisés à embarquer l'iframe.

---

## 3. Vérification frontend
```bash
npm --prefix client run lint
npm --prefix client run build
```

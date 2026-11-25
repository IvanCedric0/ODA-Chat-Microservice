# Guide d'Implémentation Frontend — Widget Chat Embarqué

Ce guide détaille les étapes de développement de l'interface utilisateur du micro-service Chat (**JavaScript standard, React, Vite, Socket.io-client**). L'application est conçue comme un widget léger destiné à être intégré dans d'autres applications via une balise HTML `<iframe>`.

---

## 1. Business Explanation (Pourquoi ce widget existe ?)

Les autres équipes de la plateforme (Forum, Streaming) souhaitent afficher un espace de discussion directement dans leurs pages sans avoir à coder l'interface de messagerie ni gérer les connexions temps réel.

* **Votre mission :** Construire une interface de chat autonome, réactive et fluide qui s'initialise à partir des paramètres reçus dans l'URL de l'`<iframe>`, affiche l'historique et les nouveaux messages en direct, et résout les noms et avatars des participants.
* **Ce que vous ne faites pas :** Vous ne gérez pas de page de connexion (Login). L'application parente qui intègre votre `<iframe>` vous fournit déjà le jeton d'authentification (`token`) et l'identifiant du salon (`topicId`).

---

## 2. Architecture Explanation (Comment le code est organisé ?)

Le projet frontend vit dans le dossier `client/` à la racine du dépôt, rédigé en **JavaScript pur (`.jsx` / `.js`)** et compilé par **Vite** vers le dossier `public/` du serveur backend :

```text
client/
├── src/
│   ├── lib/
│   │   └── socket.js           # Initialisation propre du client Socket.io (avec JSDoc)
│   ├── hooks/
│   │   ├── useChatSocket.js    # Gestion du cycle de vie WebSocket et de la liste des messages
│   │   └── useUserProfiles.js  # Résolution batch et mise en cache des noms/avatars (Identity)
│   ├── components/
│   │   ├── MessageList.jsx     # Affichage chronologique, gestion du scroll et soft-delete
│   │   ├── MessageBubble.jsx   # Rendu individuel (nom, avatar, heure, bouton supprimer)
│   │   └── MessageInput.jsx    # Champ de saisie et envoi de message
│   ├── App.jsx                 # Extraction des paramètres URL et assemblage du widget
│   └── main.jsx                # Point d'entrée React
└── vite.config.js              # Proxy de développement (port 5173 -> 3000) & build vers ../public
```

### Le flux de données côté client :
1. **Initialisation :** `App.jsx` lit `topicId` dans l'URL de l'`<iframe>`, puis reçoit le JWT avec `postMessage` depuis une origine hôte autorisée et extrait le `currentUserId` du payload.
2. **Temps réel (`useChatSocket`) :** Ouvre la connexion Socket.io, rejoint la room `topicId`, charge l'historique initial (`room_joined`) et écoute les mises à jour (`new_message`, `message_deleted`).
3. **Enrichissement UI (`useUserProfiles`) :** Comme le backend Chat ne renvoie que des identifiants numériques (`senderId`), ce hook interroge `Identity` en une seule requête groupée pour récupérer les noms et avatars manquants et les met en cache.

---

## 3. Implementation (Feuille de route par étapes)

### Étape 1 : Configuration de Vite & Conversion JS (`client/vite.config.js`)
* **Objectif :** Permettre le développement avec rechargement rapide sur le port `5173` tout en communiquant sans erreur CORS avec le backend sur le port `3000`.
* **Indices & Directions :**
  * Si le dossier `client/` a été créé avec TypeScript, convertissez-le en JavaScript pur (renommez `.tsx`/`.ts` en `.jsx`/`.js`, mettez à jour `index.html` et retirez `tsconfig*.json`).
  * Dans `vite.config.js`, définissez `base: '/embed/'` et `build.outDir: '../public'`.
  * Configurez `server.proxy` pour rediriger `/api` et `/socket.io` (avec `ws: true`) vers `http://localhost:3000`.

### Étape 2 : Extraction des paramètres & Identité courante (`src/App.jsx`)
* **Objectif :** Récupérer le contexte d'exécution dès le montage du composant.
* **Indices & Directions :**
  * Utilisez `new URLSearchParams(window.location.search)` pour lire `topicId` (converti en nombre). Ne lisez jamais le JWT depuis l'URL.
  * Configurez `VITE_CHAT_PARENT_ORIGINS` avec les origines hôtes exactes autorisées.
  * Recevez `{ type: 'SET_AUTH_TOKEN', token }` par `postMessage`, en vérifiant l'origine et la fenêtre parente.
  * Pour savoir quels messages appartiennent à l'utilisateur connecté, décodez ensuite la partie centrale du JWT pour lire `userId` ou `sub`.

### Étape 3 : Encapsulation du Client Socket.io (`src/lib/socket.js` & `src/hooks/useChatSocket.js`)
* **Objectif :** Isoler la logique réseau des composants visuels React.
* **Indices & Directions :**
  * Dans `socket.js`, créez `io({ auth: { token }, autoConnect: false })`. Ajoutez un commentaire JSDoc pointant vers `../../../shared/contracts` pour conserver l'autocomplétion des événements dans VS Code.
  * Dans `useChatSocket.js` (à l'intérieur d'un `useEffect`) :
    * Attachez les écouteurs `connect`, `room_joined`, `new_message`, `message_deleted` et `error_event` **avant** d'appeler `socket.connect()`.
    * **Point critique :** Émettez `socket.emit('join_topic', { topicId })` à l'intérieur de l'événement `'connect'`. Ainsi, si le réseau coupe puis se rétablit automatiquement, l'utilisateur rejoint à nouveau le salon sans action manuelle.
    * Nettoyez tous les écouteurs (`socket.off(...)`) et appelez `socket.disconnect()` dans la fonction de retour du `useEffect`.

### Étape 4 : Résolution Optimisée des Profils (`src/hooks/useUserProfiles.js`)
* **Objectif :** Afficher les vrais noms et avatars sans surcharger le réseau ni le service `Identity`.
* **Indices & Directions :**
  * Maintenez un dictionnaire en mémoire ou dans `sessionStorage` : `{ [userId]: { name, avatar } }`.
  * À chaque mise à jour de la liste des messages ou des participants, extrayez les `userId` uniques qui ne sont **pas encore** dans votre cache.
  * Si la liste des IDs manquants n'est pas vide, effectuez **un seul appel groupé** (`POST /api/v1/users/batch` avec `{ ids }`) et fusionnez la réponse dans le cache.
  * **Repli gracieux (*Graceful Fallback*) :** Pendant le chargement ou si `Identity` est indisponible, vos composants doivent afficher `Utilisateur #<id>` et un avatar par défaut (initiales) sans jamais bloquer l'affichage des messages.

### Étape 5 : Composants d'Interface & Interactions (`src/components/`)
* **Objectif :** Créer une expérience utilisateur réactive et soignée.
* **Indices & Directions :**
  * **`MessageList.jsx`** : Utilisez une `useRef` en bas de la liste avec `scrollIntoView({ behavior: 'smooth' })` pour défiler automatiquement à chaque nouveau message.
  * **`MessageBubble.jsx`** :
    * Si `message.isDeleted` est `true`, affichez un texte en italique (*« Ce message a été supprimé »*) et masquez les actions.
    * Si `message.senderId === currentUserId` et que le message n'est pas supprimé, affichez un bouton permettant d'émettre `delete_message` (ou d'appeler `DELETE /api/v1/messages/:id`).
  * **`MessageInput.jsx`** : Empêchez l'envoi de chaînes vides ou composées uniquement d'espaces (`content.trim()`), et videz le champ immédiatement après l'émission de `send_message`.

---

## 4. Tests (Validation de l'interface et des flux)

1. **Test de communication multi-onglets :**
   * Intégrez le widget dans une page hôte locale et configurez son origine exacte dans `client/.env.local` via `VITE_CHAT_PARENT_ORIGINS`.
   * Transmettez deux jetons de test différents aux iframes avec `postMessage` après réception de l'événement `CHAT_READY`.
   * Vérifiez que l'envoi, la réception et la suppression d'un message se reflètent instantanément des deux côtés sans recharger la page.
2. **Test de résilience (Panique réseau & Indisponibilité `Identity`) :**
   * Coupez temporairement l'accès à l'endpoint `Identity` (ou simulez une erreur réseau dans les DevTools du navigateur) et vérifiez que le chat reste utilisable grâce au repli `Utilisateur #<id>`.
   * Simulez une coupure réseau (mode *Offline* 3 secondes dans DevTools puis retour en ligne) pour vérifier que la reconnexion automatique réinscrit bien le client dans le salon.
3. **Test d'intégration `<iframe>` :**
   * Créez un fichier HTML externe minimal contenant `<iframe src="http://localhost:3000/embed/?topicId=1" width="400" height="600"></iframe>`.
   * Attendez le message `CHAT_READY`, puis transmettez `{ type: 'SET_AUTH_TOKEN', token }` avec `postMessage` en ciblant l'origine exacte du widget.

---

## 5. Key Decisions (Décisions d'architecture à maîtriser)

* **Pourquoi l'agrégation des profils côté client (*UI Composition*) ?** Garder les noms et avatars côté `Identity` et les résoudre depuis le navigateur évite toute duplication de données dans le backend Chat et garantit que les modifications de profil sont toujours à jour.
* **Pourquoi le *Batching* + Cache plutôt qu'un appel par message ?** Évite le problème des requêtes $N+1$ (faire 50 requêtes HTTP pour afficher 50 messages) et réduit quasi à zéro les appels réseau lors du passage d'un salon à un autre.
* **Pourquoi React compilé avec Vite en statique ?** Offre toute la puissance de React pour gérer les états temps réel complexes tout en générant de simples fichiers statiques servis directement par Fastify (un seul serveur à déployer).

---

## 6. Verify (Comment vérifier votre travail ?)

1. Démarrez le backend (`npm run dev` à la racine) et le serveur de développement Vite (`npm --prefix client run dev`).
2. Vérifiez que l'application s'affiche sur `http://localhost:5173/embed/?topicId=1` et attend le token de l'application hôte.
3. Testez la compilation finale avec `npm --prefix client run build` :
   * Vérifiez que les fichiers générés apparaissent bien dans `public/`.
   * Accédez à `http://localhost:3000/embed/?topicId=1` (port du backend Fastify), intégrez la page depuis une origine autorisée et validez le transfert du token via `postMessage`.

---

## 7. Review Checklist (Avant de valider la PR)

- [ ] Aucune URL `http://localhost:3000` n'est écrite en dur dans le code React (utilisation des chemins relatifs et du proxy Vite).
- [ ] Les écouteurs Socket.io sont tous nettoyés dans le retour du `useEffect` (pas de messages dupliqués en mode développement React StrictMode).
- [ ] L'émission de `join_topic` est bien déclenchée à chaque événement `'connect'` du socket.
- [ ] Les requêtes vers `Identity` dédupliquent les identifiants et utilisent le cache local avant tout appel réseau.
- [ ] Les messages supprimés (`isDeleted: true`) affichent un état visuel distinct et ne révèlent plus leur contenu d'origine.
- [ ] La commande `npm --prefix client run build` s'exécute sans avertissement ni erreur et produit un bundle propre dans `public/`.
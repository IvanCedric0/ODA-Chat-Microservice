# Micro-service Chat (`oda-chat-service`)

Micro-service d'infrastructure applicatif transverse fournissant une messagerie instantanée temps réel multi-tenant, conçu avec **Fastify**, **Socket.io**, **Prisma ORM**, **PostgreSQL** et un widget embarqué en **React**.

> 📖 Pour les détails d'architecture exhaustifs et les choix de conception, consultez le document :  
> [docs/Spécification Technique d'Architecture - Micro-service Chat.pdf](file:///Users/IvanCedric/projects/oda-chat-service/docs/Spécification%20Technique%20d'Architecture%20-%20Micro-service%20Chat.pdf)

---

## 🧭 Guide d'Intégration pour les Services Tiers

Ce micro-service est mutualisé : il est destiné à être consommé par d'autres services métier de la plateforme (forums, plateformes de streaming, espaces collaboratifs, etc.).

### 1. Principe d'Identité & Sécurité
- **Délégation d'identité :** Ce micro-service ne gère aucun compte ni mot de passe.
- Les identifiants (`user_id`) doivent correspondre à ceux émis par le service central **Identity**.
- Toute action utilisateur (envoi de message, connexion Socket) requiert un jeton **JWT valide** signé par le service Identity. Le `sender_id` est systématiquement extrait du JWT pour empêcher toute usurpation d'identité.

---

### 2. Flux d'Intégration Métier

```
[Service Métier (ex: Forum)] ──(1. Crée le salon)──> [API Chat: POST /api/v1/topics]
                                                               │
                                                    (Retourne id & embed_url)
                                                               │
                                                               ▼
[Application Hôte / Web] <──(2. Reçoit l'URL)──────── [Service Métier]
       │
       ├──(Option A : Widget prêt à l'emploi via <iframe> + postMessage)
       └──(Option B : Mode Headless via Socket.io + API REST)
```

#### Étape 1 : Création d'un salon de discussion (*Topic*)
Votre service crée un salon privé en fournissant son nom de service (`service_name`), un titre et la liste initiale des `user_id` autorisés :

```http
POST /api/v1/topics
Content-Type: application/json

{
  "service_name": "forum",
  "title": "Entraide Cours d'Algorithmique",
  "participant_ids": [108, 114, 250]
}
```

**Réponse `201 Created` :**
```json
{
  "id": 42,
  "embed_url": "https://chat.domain.local/embed/?topicId=42"
}
```

#### Étape 2 : Gestion des Participants
Vous pouvez dynamiquement ajouter ou retirer des participants au fil de l'eau :

- **Ajouter des membres :**
  ```http
  POST /api/v1/topics/42/participants
  Content-Type: application/json

  { "user_ids": [310, 412] }
  ```
- **Retirer un membre :**
  ```http
  DELETE /api/v1/topics/42/participants/108
  ```

---

### 3. Intégration Côté Client / Application Hôte

Deux modes d'intégration sont mis à disposition :

#### Option A : Widget Clé en Main (`<iframe>`)
Idéal pour intégrer le chat en quelques lignes sans développer d'interface.

> 🔒 **Bonne pratique de sécurité :** Pour éviter toute fuite de jeton dans l'historique ou les logs d'URL, **ne passez jamais le JWT dans l'URL de l'iFrame**. Utilisez `window.postMessage` avec restriction stricte du domaine cible (`targetOrigin`).

```html
<!-- 1. Balise iFrame pointant sur l'embed_url -->
<iframe
  id="chat-iframe"
  src="https://chat.domain.local/embed/?topicId=42"
  width="100%"
  height="600"
  style="border: none;"
></iframe>

<script>
  const frame = document.getElementById('chat-iframe');
  const CHAT_ORIGIN = 'https://chat.domain.local';
  // Configurez VITE_CHAT_PARENT_ORIGINS avec l'origine exacte de cette application.

  const userJwt = "eyJhbGciOiJIUzI1Ni..."; // Jeton de session utilisateur émis par Identity
  const topicId = 42;
  const usersById = new Map([
    [108, { id: 108, name: 'Amira' }],
    [114, { id: 114, name: 'Noah' }]
  ]);
  let onlineUsers = [{ id: 108, name: 'Amira' }]; // Remplacez par la présence initiale de l'application.

  const sendOnlineUsers = () => {
    frame.contentWindow?.postMessage(
      { type: 'SET_ONLINE_USERS', users: onlineUsers },
      CHAT_ORIGIN
    );
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== CHAT_ORIGIN || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'CHAT_READY') {
      frame.contentWindow?.postMessage(
        { type: 'SET_AUTH_TOKEN', token: userJwt },
        CHAT_ORIGIN
      );
      sendOnlineUsers();
      return;
    }

    if (
      !['CHAT_JOIN', 'CHAT_LEAVE'].includes(event.data?.type)
      || event.data.topicId !== topicId
    ) return;

    const user = usersById.get(event.data.userId);
    if (!user) return;

    onlineUsers = onlineUsers.filter((onlineUser) => onlineUser.id !== user.id);
    if (event.data.type === 'CHAT_JOIN') onlineUsers.push(user);
    sendOnlineUsers();
  });
</script>
```

Dans le client du chat, définissez `VITE_CHAT_PARENT_ORIGINS` avec l’origine exacte de l’application hôte (par exemple `https://forum.domain.local`). Les tokens fournis dans l’URL sont ignorés.
Après connexion, le widget envoie `{ type: 'CHAT_JOIN', topicId, userId }`; lorsqu’il quitte via le bouton dédié, il envoie `{ type: 'CHAT_LEAVE', topicId, userId }`. L’hôte peut utiliser ces événements pour actualiser sa présence. Il reste responsable de détecter les fermetures de page ou autres déconnexions inattendues.

#### Option B : Mode Headless (Client Socket.io personnalisé)
Si votre application cliente dispose de sa propre UI (React, Vue, mobile, etc.), connectez-vous directement au gateway Socket.io :

```typescript
import { io } from "socket.io-client";

const socket = io("https://chat.domain.local", {
  auth: {
    token: "eyJhbGciOiJIUzI1Ni...", // Jeton JWT de l'utilisateur
    topicId: 42
  },
  transports: ["websocket", "polling"]
});

// Écouter les messages entrants
socket.on("new_message", (message) => {
  console.log("Nouveau message :", message);
});

// Écouter les suppressions
socket.on("message_deleted", ({ message_id }) => {
  console.log("Message supprimé :", message_id);
});

// Envoyer un message
function sendMessage(text) {
  socket.emit("send_message", { content: text });
}
```

---

## 📡 Synthèse des Interfaces

### Endpoints REST (Fastify)
La documentation OpenAPI / Swagger interactive complète est consultable sur **`/docs`**.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/topics` | Création d'un salon (`service_name`, `title`, `participant_ids`) |
| `POST` | `/api/v1/topics/:id/participants` | Ajout d'utilisateurs (`user_ids`) |
| `DELETE` | `/api/v1/topics/:id/participants/:uid` | Retrait d'un utilisateur du salon |
| `GET` | `/api/v1/topics/:id/messages` | Récupération de l'historique (`limit`, `before_id`) |
| `DELETE` | `/api/v1/messages/:id` | Suppression logique d'un message (*Soft Delete*) |

### Événements Temps Réel (Socket.io)
- **Handshake :** Initialisé sur `/socket.io/` avec vérification stricte : l'utilisateur doit être participant du salon demandé.
- **Client $\rightarrow$ Serveur :**
  - `send_message` : `{ content: string }`
  - `delete_message` : `{ message_id: number }` (seul l'auteur peut supprimer son message)
- **Serveur $\rightarrow$ Room (`topic_<id>`) :**
  - `new_message` : `{ id, topic_id, sender_id, content, created_at }`
  - `message_deleted` : `{ message_id }`

---

## 💻 Développement & Déploiement Local

### Prérequis
- **Node.js** >= 20.x
- **Docker** & **Docker Compose** (ou une instance **PostgreSQL** >= 15.x locale)
- **npm**

### 1. Installation des dépendances
```bash
# Dépendances du micro-service backend et du widget client
npm install
npm --prefix client install
```

### 2. Démarrage de la base de données (Docker)
Un fichier `docker-compose.yml` est fourni pour lancer rapidement la base PostgreSQL dédiée. Elle est exposée sur le port **5433** de l'hôte afin d'éviter tout conflit avec une éventuelle instance PostgreSQL locale sur le port 5432 :

```bash
# Démarrer le conteneur PostgreSQL en arrière-plan
docker compose up -d

# Vérifier l'état du conteneur
docker compose ps
```

> 💡 Pour arrêter le conteneur tout en conservant les données (volume `chat_pgdata`) : `docker compose down`.

### 3. Configuration (`.env`)
```bash
cp .env.example .env
```
Renseignez les variables requises :
- `PORT` : Port du serveur HTTP (ex. `3000`).
- `DATABASE_URL` : Chaîne de connexion PostgreSQL. Si vous utilisez le service Docker fourni :
  ```env
  DATABASE_URL="postgresql://chat_user:chat_db@localhost:5433/chat_user?schema=public"
  ```
- `JWT_SECRET` : Clé secrète partagée avec le service Identity pour la validation des jetons.
- `ALLOWED_ORIGINS` : Origines autorisées pour les requêtes CORS et l'en-tête CSP `frame-ancestors`.

### 4. Base de données & Migrations (Prisma)
Une fois la base de données accessible :
```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 5. Démarrage
```bash
# Mode développement (Fastify avec rechargement à chaud)
npm run dev

# Démarrage du widget client en mode standalone (optionnel)
npm --prefix client run dev
```
- API & Serveur : `http://localhost:3000`
- Swagger UI interactif : `http://localhost:3000/docs`

Pour tester l’intégration sécurisée en local, ouvrez `http://localhost:5173/embed/host-preview.html` (ou remplacez le port par l’adresse Vite affichée). Entrez un salon et un JWT valide d’un participant; la page hôte transmettra le token et les utilisateurs en ligne par `postMessage`. Les onglets de démonstration synchronisent les arrivées et les départs du même salon pour actualiser la présence.

### 6. Build de Production
```bash
npm run build   # Compile le backend TypeScript et package le widget React
npm start       # Démarre le serveur en production
```

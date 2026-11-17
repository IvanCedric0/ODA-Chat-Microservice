# ADR-0001 : Décisions d'Architecture du Micro-service Chat

* **Statut :** Accepté
* **Date :** 2026-11-17
* **Composant :** `chat-microservice`

---

## 1. Contexte et Problématique

Le micro-service Chat doit fournir une messagerie instantanée multi-tenant consommable par d'autres services de l'écosystème (via API REST + WebSockets et via un widget embarqué `<iframe>`). L'authentification et la gestion des utilisateurs sont entièrement déléguées au micro-service externe `Identity`.

Trois décisions structurantes devaient être arrêtées avant le démarrage de l'implémentation :
1. Le choix de la pile technique backend et temps réel.
2. L'organisation linguistique entre le backend et le widget frontend.
3. La stratégie de récupération des noms d'affichage et avatars des utilisateurs.

---

## 2. Décisions Retenues

### Décision 1 : Stack Backend Node.js avec Fastify (TypeScript), Prisma et Socket.io
* **Choix :** Utiliser **Fastify** (en TypeScript) pour l'API REST et la diffusion statique, **Socket.io** pour le temps réel, et **Prisma ORM** sur **PostgreSQL**.
* **Justification :**
  * Socket.io fournit nativement le mécanisme de *Rooms* (`socket.join`, `io.to().emit`), éliminant le développement et la maintenance d'un gestionnaire de connexions WebSocket personnalisé.
  * Fastify intègre la validation des requêtes (Ajv) et génère automatiquement la documentation interactive OpenAPI/Swagger (`/docs`), facilitant l'intégration par les équipes tierces.
  * Prisma garantit l'intégrité relationnelle des salons privés (`TopicParticipant`) et un typage strict de bout en bout.

### Décision 2 : Backend TypeScript + Frontend React JavaScript (Vite) avec Contrats Partagés
* **Choix :** Développer le serveur (`src/`) en **TypeScript** et le widget iFrame (`client/`) en **JavaScript (React + Vite)**, reliés par un fichier unique `shared/contracts.ts`.
* **Justification :**
  * Permet aux deux développeurs de travailler en parallèle selon leurs préférences techniques sans bloquer le développement.
  * Le frontend JavaScript conserve l'autocomplétion sur les événements Socket.io et les DTOs grâce aux imports JSDoc pointant vers `shared/contracts.ts`.
  * Vite compile le widget React en fichiers statiques dans `public/`, servis directement par Fastify sur `/embed/` (un seul conteneur à déployer).

### Décision 3 : Agrégation des Profils Utilisateurs Côté Client (UI Composition)
* **Choix :** Le micro-service Chat ne stocke que les `user_id` (entiers). Le widget React résout les noms et avatars directement auprès du service `Identity` via un appel groupé (`POST /api/v1/users/batch`), couplé à un cache de session (`sessionStorage`) et un affichage de repli (`Utilisateur #<id>`).
* **Justification :**
  * Préserve `Identity` comme source unique de vérité (aucune désynchronisation si un utilisateur modifie son avatar ou son nom).
  * Évite toute duplication de données personnelles dans la base PostgreSQL du Chat.
  * Évite de créer un goulot d'étranglement réseau côté serveur lors de la récupération de l'historique des messages.

---

## 3. Alternatives Écartées

* **Stockage d'un snapshot `(name, avatar)` dans la table `topic_participants` :** Écarté car les profils deviendraient obsolètes dès qu'un utilisateur modifie son compte dans `Identity`, et cela obligerait les services appelants à transmettre des métadonnées d'affichage à chaque ajout de membre.
* **Appels synchrones Backend-to-Backend (`Chat -> Identity`) à chaque chargement d'historique :** Écarté pour éviter d'augmenter la latence des réponses API et de coupler la disponibilité du Chat à celle du service `Identity`.
* **Python (FastAPI + SQLAlchemy) :** Écarté au profit de Node.js/Fastify afin de bénéficier de la gestion native des salons dans Socket.io et de conserver un écosystème JavaScript/TypeScript unifié entre le serveur et le client WebSocket.

---

## 4. Conséquences & Points d'Attention

* **Dépendance à l'endpoint batch d'`Identity` :** Le frontend nécessite que le service `Identity` expose un endpoint permettant de récupérer plusieurs profils à partir d'une liste d'identifiants (`POST /api/v1/users/batch`).
* **Gestion du cache client :** Le widget doit impérativement dédupliquer les `user_id` avant d'interroger `Identity` et conserver les résultats en mémoire/session afin de minimiser les requêtes réseau lors du passage d'un salon à un autre.
# Contrat d'Intégration du Widget

Accord sur les modalités de lancement du widget de chat embarqué par les applications hôtes :

### Format de l'URL Iframe
`/embed/?topicId=<number>&token=<jwt>`

### Paramètres d'URL (Query Params)
- **`topicId`** : Extrait via `new URLSearchParams(window.location.search).get('topicId')`.
- **`token`** : Transmis à `createChatSocket(token)` et en en-tête `Authorization: Bearer <token>` pour les requêtes REST (`GET /api/v1/topics/:id/messages`).

### Tests & Swagger UI
- **Documentation Swagger :** [http://localhost:3000/docs](http://localhost:3000/docs) (pour créer des salons de test en un clic, sans avoir à demander).

# Contrat d'Intégration du Widget

Accord sur les modalités de lancement du widget de chat embarqué par les applications hôtes :

### Format de l'URL Iframe
`/embed/?topicId=<number>`

### Paramètres d'URL (Query Params)
- **`topicId`** : Extrait via `new URLSearchParams(window.location.search).get('topicId')`.

### Authentification du widget
- L'application hôte transmet le JWT par `postMessage` avec `{ type: 'SET_AUTH_TOKEN', token }`.
- Le widget n'accepte les messages que depuis l'origine exacte configurée dans `VITE_CHAT_PARENT_ORIGINS` et provenant de sa fenêtre parente.
- Le widget annonce qu'il est prêt avec `{ type: 'CHAT_READY' }`.
- L'hôte peut fournir la présence avec `{ type: 'SET_ONLINE_USERS', users: [{ id, name }] }` et la mettre à jour à chaque changement.
- Le widget notifie l'hôte après connexion avec `{ type: 'CHAT_JOIN', topicId, userId }` et au départ avec `{ type: 'CHAT_LEAVE', topicId, userId }`.
- L'hôte reste responsable de la présence et peut utiliser ces événements pour actualiser sa liste.
- Ne transmettez jamais le JWT dans l'URL de l'iframe.

### Tests & Swagger UI
- **Documentation Swagger :** [http://localhost:3000/docs](http://localhost:3000/docs) (pour créer des salons de test en un clic, sans avoir à demander).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import type { MessageDTO, TopicDTO, ClientToServerEvents, ServerToClientEvents } from '../../shared/contracts.js';

describe('Vérification Étape 1 & 2 — Micro-service Chat', () => {

  // ---------------------------------------------------------------------------
  // 1. Tests Configuration Environnement (Étape 2)
  // ---------------------------------------------------------------------------
  describe('Configuration & Variables d\'Environnement (src/config/env.ts)', () => {
    it('doit charger les variables d\'environnement sans erreur', () => {
      assert.ok(env, 'L\'objet env doit être défini');
      assert.ok(typeof env.port === 'string', 'env.port doit être une chaîne');
      assert.ok(typeof env.databaseUrl === 'string', 'env.databaseUrl doit être une chaîne');
      assert.ok(typeof env.nodeEnv === 'string', 'env.nodeEnv doit être une chaîne');
    });

    it('databaseUrl doit être une URL PostgreSQL valide', () => {
      assert.match(
        env.databaseUrl,
        /^postgresql:\/\//,
        'DATABASE_URL doit commencer par "postgresql://"'
      );
    });

    it('port doit être convertible en nombre valide', () => {
      const portNum = Number(env.port);
      assert.ok(!Number.isNaN(portNum) && portNum > 0, `Le port doit être un nombre valide (reçu: ${env.port})`);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Tests Contrats & DTOs (Étape 2)
  // ---------------------------------------------------------------------------
  describe('Contrats Partagés (shared/contracts.ts)', () => {
    it('doit valider la conformité structurelle de MessageDTO et TopicDTO', () => {
      const mockMessage: MessageDTO = {
        id: 1,
        topicId: 42,
        senderId: 108,
        content: 'Test message',
        isDeleted: false,
        createdAt: new Date().toISOString()
      };

      const mockTopic: TopicDTO = {
        id: 42,
        serviceName: 'forum',
        title: 'Entraide',
        particpantsIds: [108, 114]
      };

      assert.strictEqual(mockMessage.content, 'Test message');
      assert.strictEqual(mockTopic.id, 42);
      assert.strictEqual(mockTopic.particpantsIds.length, 2);
    });

    it('doit valider la présence des types d\'événements Socket.io', () => {
      // Vérification au compile-time des interfaces Socket.io
      const clientEvents: Partial<ClientToServerEvents> = {
        send_message: (payload) => {
          assert.ok(payload.topicId);
          assert.ok(payload.content);
        }
      };

      const serverEvents: Partial<ServerToClientEvents> = {
        room_joined: (payload) => {
          assert.ok(payload.topicId);
          assert.ok(Array.isArray(payload.history));
        }
      };

      assert.ok(clientEvents.send_message);
      assert.ok(serverEvents.room_joined);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Tests Base de Données & Modèles Prisma (Étape 1 & 2)
  // ---------------------------------------------------------------------------
  describe('PostgreSQL & Prisma Client (src/config/prisma.ts & prisma/schema.prisma)', () => {
    let createdTopicId: number | null = null;

    before(async () => {
      try {
        // Ping de connexion
        await prisma.$queryRaw`SELECT 1 as ping`;
      } catch (err: any) {
        throw new Error(
          `Impossible de se connecter à PostgreSQL (${err.message}). ` +
          `Assurez-vous que Docker tourne bien avec "docker compose up -d".`
        );
      }
    });

    after(async () => {
      // Nettoyage si besoin
      if (createdTopicId) {
        try {
          await prisma.topic.delete({ where: { id: createdTopicId } });
        } catch {
          // Déjà supprimé ou ignoré
        }
      }
      await prisma.$disconnect();
    });

    it('doit exécuter une requête simple sur PostgreSQL (SELECT 1)', async () => {
      const result = await prisma.$queryRaw<Array<{ ping: number }>>`SELECT 1 as ping`;
      assert.ok(Array.isArray(result) && result.length > 0, 'La requête SELECT 1 doit retourner un résultat');
    });

    it('doit pouvoir créer un Topic avec des Participants imbriqués (Cascade / Relations)', async () => {
      const topic = await prisma.topic.create({
        data: {
          serviceName: 'test_service',
          title: 'Salon de Test Automatisé',
          participants: {
            create: [
              { userId: 9901 },
              { userId: 9902 }
            ]
          }
        },
        include: {
          participants: true
        }
      });

      createdTopicId = topic.id;

      assert.ok(topic.id > 0, 'Le topic doit avoir un ID auto-incrémenté');
      assert.strictEqual(topic.serviceName, 'test_service');
      assert.strictEqual(topic.participants.length, 2, 'Les 2 participants doivent être créés');
    });

    it('doit refuser un participant en double dans le même Topic (Contrainte @@id([topicId, userId]))', async () => {
      assert.ok(createdTopicId, 'Le topic de test doit exister');

      await assert.rejects(
        async () => {
          await prisma.topicParticipant.create({
            data: {
              topicId: createdTopicId!,
              userId: 9901 // Déjà inséré lors du test précédent
            }
          });
        },
        /Unique constraint failed|P2002/i,
        'Prisma doit rejeter l\'insertion d\'un membre en doublon'
      );
    });

    it('doit persister un Message dans le Topic', async () => {
      assert.ok(createdTopicId, 'Le topic de test doit exister');

      const message = await prisma.message.create({
        data: {
          topicId: createdTopicId!,
          senderId: 9901,
          content: 'Ceci est un message de test'
        }
      });

      assert.ok(message.id > 0n, 'Le message doit avoir un BigInt ID');
      assert.strictEqual(message.content, 'Ceci est un message de test');
      assert.strictEqual(message.isDeleted, false, 'is_deleted doit être false par défaut');
    });

    it('doit supprimer en cascade les participants et messages lors de la suppression du Topic', async () => {
      assert.ok(createdTopicId, 'Le topic de test doit exister');

      // Suppression du Topic
      await prisma.topic.delete({ where: { id: createdTopicId! } });

      // Vérification que les participants ont été supprimés en cascade
      const participantsCount = await prisma.topicParticipant.count({
        where: { topicId: createdTopicId! }
      });
      assert.strictEqual(participantsCount, 0, 'Les participants doivent être supprimés en cascade');

      // Vérification que les messages ont été supprimés en cascade
      const messagesCount = await prisma.message.count({
        where: { topicId: createdTopicId! }
      });
      assert.strictEqual(messagesCount, 0, 'Les messages doivent être supprimés en cascade');

      createdTopicId = null; // Nettoyé
    });
  });
});

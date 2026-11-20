import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { topicRepository } from '../repositories/topic.repo.js';
import { messageRepository } from '../repositories/message.repo.js';
import { prisma } from '../config/prisma.js';

describe('Étape 3 : Tests Couche Repositories (TopicRepository & MessageRepository)', () => {
  let createdTopicId: number;
  let firstMessageId: bigint;
  let secondMessageId: bigint;
  let thirdMessageId: bigint;

  before(async () => {
    // Vérification de la disponibilité de PostgreSQL avant de lancer les tests
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
      throw new Error(
        `Impossible de se connecter à PostgreSQL (${err.message}). ` +
        `Assurez-vous que Docker tourne bien avec "docker compose up -d".`
      );
    }
  });

  after(async () => {
    // Nettoyage complet : supprimer le topic supprime en cascade participants et messages
    if (createdTopicId) {
      try {
        await prisma.topic.delete({ where: { id: createdTopicId } });
      } catch {
        // Ignorer si déjà supprimé
      }
    }
    await prisma.$disconnect();
  });

  // 1. Tests de TopicRepository
  describe('TopicRepository', () => {
    it('doit créer un salon avec participants imbriqués (createTopicWithParticipants)', async () => {
      const topic = await topicRepository.createTopicWithParticipants({
        serviceName: 'forum',
        title: 'Salon Test Repositories',
        participants: [1001, 1002]
      });

      assert.ok(topic, 'Le topic doit être retourné');
      assert.ok(typeof topic.id === 'number' && topic.id > 0, 'Le topic doit avoir un ID numérique auto-incrémenté');
      assert.strictEqual(topic.serviceName, 'forum');
      assert.strictEqual(topic.title, 'Salon Test Repositories');

      createdTopicId = topic.id;

      // Vérifier que les participants ont bien été insérés
      const count = await prisma.topicParticipant.count({ where: { topicId: createdTopicId } });
      assert.strictEqual(count, 2, 'Il doit y avoir exactement 2 participants créés');
    });

    it('doit retrouver un salon par son ID (findTopicById)', async () => {
      const found = await topicRepository.findTopicById(createdTopicId);
      assert.ok(found, 'Le topic existant doit être retrouvé');
      assert.strictEqual(found?.id, createdTopicId);
      assert.strictEqual(found?.title, 'Salon Test Repositories');

      // Test avec un ID inexistant
      const notFound = await topicRepository.findTopicById(999999);
      assert.strictEqual(notFound, null, 'Un ID inexistant doit retourner null');
    });

    it('doit vérifier l\'appartenance d\'un utilisateur au salon (isParticipant)', async () => {
      // 1001 et 1002 sont membres
      const isMember1 = await topicRepository.isParticipant(createdTopicId, 1001);
      const isMember2 = await topicRepository.isParticipant(createdTopicId, 1002);
      assert.strictEqual(isMember1, true, 'L\'utilisateur 1001 doit être reconnu comme participant');
      assert.strictEqual(isMember2, true, 'L\'utilisateur 1002 doit être reconnu comme participant');

      // 9999 n'est pas membre
      const isNotMember = await topicRepository.isParticipant(createdTopicId, 9999);
      assert.strictEqual(isNotMember, false, 'Un utilisateur non inscrit doit retourner false');
    });

    it('doit ajouter des participants en ignorant les doublons sans planter (addParticipants avec skipDuplicates)', async () => {
      // 1002 est déjà dans le salon, 1003 est nouveau
      const result = await topicRepository.addParticipants(createdTopicId, [1002, 1003]);

      assert.ok(result, 'L\'opération doit réussir sans lever d\'erreur P2002');
      assert.strictEqual(result.count, 1, 'Seul 1 participant (1003) doit avoir été inséré');

      // Vérifier que 1003 est maintenant membre
      const isMember3 = await topicRepository.isParticipant(createdTopicId, 1003);
      assert.strictEqual(isMember3, true, 'Le nouveau membre 1003 doit être présent');
    });

    it('doit supprimer un participant du salon (deleteParticipant)', async () => {
      await topicRepository.deleteParticipant(createdTopicId, 1003);

      const stillMember = await topicRepository.isParticipant(createdTopicId, 1003);
      assert.strictEqual(stillMember, false, 'Le membre 1003 ne doit plus être dans le salon');
    });
  });

  // 2. Tests de MessageRepository
  describe('MessageRepository', () => {
    it('doit créer et persister des messages (createMessage)', async () => {
      const msg1 = await messageRepository.createMessage({
        topicId: createdTopicId,
        senderId: 1001,
        content: 'Premier message'
      });
      firstMessageId = msg1.id;

      const msg2 = await messageRepository.createMessage({
        topicId: createdTopicId,
        senderId: 1002,
        content: 'Deuxième message'
      });
      secondMessageId = msg2.id;

      const msg3 = await messageRepository.createMessage({
        topicId: createdTopicId,
        senderId: 1001,
        content: 'Troisième message'
      });
      thirdMessageId = msg3.id;

      assert.ok(firstMessageId > 0n, 'Le message 1 doit avoir un ID BigInt');
      assert.ok(secondMessageId > firstMessageId, 'Les IDs doivent être séquentiels');
      assert.ok(thirdMessageId > secondMessageId, 'Le message 3 a le plus grand ID');
      assert.strictEqual(msg1.isDeleted, false, 'isDeleted doit valoir false par défaut');
    });

    it('doit retrouver un message par son ID (findMessageById)', async () => {
      const found = await messageRepository.findMessageById(firstMessageId);
      assert.ok(found, 'Le message doit être retrouvé');
      assert.strictEqual(found?.content, 'Premier message');
      assert.strictEqual(found?.senderId, 1001);

      // ID inexistant
      const notFound = await messageRepository.findMessageById(99999999n);
      assert.strictEqual(notFound, null, 'Un ID inconnu doit retourner null');
    });

    it('doit récupérer l\'historique trié par date décroissante (findMessagesByTopic sans beforeId)', async () => {
      const messages = await messageRepository.findMessagesByTopic({
        topicId: createdTopicId,
        limit: 50
      });

      assert.strictEqual(messages.length, 3, 'Doit retourner les 3 messages créés');
      // Le plus récent (troisième) doit être en premier
      assert.strictEqual(messages[0]?.id, thirdMessageId);
      assert.strictEqual(messages[1]?.id, secondMessageId);
      assert.strictEqual(messages[2]?.id, firstMessageId);
    });

    it('doit respecter la limite de pagination (findMessagesByTopic avec limit)', async () => {
      const messages = await messageRepository.findMessagesByTopic({
        topicId: createdTopicId,
        limit: 2
      });

      assert.strictEqual(messages.length, 2, 'Doit retourner exactement 2 messages');
      assert.strictEqual(messages[0]?.id, thirdMessageId);
      assert.strictEqual(messages[1]?.id, secondMessageId);
    });

    it('doit paginer avec beforeId (messages plus anciens que beforeId)', async () => {
      // On demande les messages situés avant le troisième message
      const messages = await messageRepository.findMessagesByTopic({
        topicId: createdTopicId,
        beforeId: thirdMessageId,
        limit: 10
      });

      assert.strictEqual(messages.length, 2, 'Doit retourner 2 messages plus anciens que thirdMessageId');
      assert.strictEqual(messages[0]?.id, secondMessageId);
      assert.strictEqual(messages[1]?.id, firstMessageId);
    });

    it('doit paginer de façon déterministe sans sauter de message même avec des timestamps identiques (P1 fix)', async () => {
      // Salon dédié pour isoler complètement ce test des autres messages
      const dedicatedTopic = await topicRepository.createTopicWithParticipants({
        serviceName: 'forum',
        title: 'Salon Dédié Test Pagination',
        participants: [2001, 2002]
      });

      try {
        const sameTimestamp = new Date('2026-11-20T12:00:00.000Z');

        const m1 = await prisma.message.create({
          data: { topicId: dedicatedTopic.id, senderId: 2001, content: 'same-time-1', createdAt: sameTimestamp }
        });
        const m2 = await prisma.message.create({
          data: { topicId: dedicatedTopic.id, senderId: 2001, content: 'same-time-2', createdAt: sameTimestamp }
        });
        const m3 = await prisma.message.create({
          data: { topicId: dedicatedTopic.id, senderId: 2001, content: 'same-time-3', createdAt: sameTimestamp }
        });

        // Pagination page par page (limit: 1)
        const page1 = await messageRepository.findMessagesByTopic({
          topicId: dedicatedTopic.id,
          limit: 1
        });
        assert.strictEqual(page1.length, 1);
        assert.strictEqual(page1[0]?.id, m3.id, 'Page 1 doit renvoyer le plus grand ID (m3)');

        const page2 = await messageRepository.findMessagesByTopic({
          topicId: dedicatedTopic.id,
          limit: 1,
          beforeId: m3.id
        });
        assert.strictEqual(page2.length, 1);
        assert.strictEqual(page2[0]?.id, m2.id, 'Page 2 doit renvoyer m2 sans le sauter');

        const page3 = await messageRepository.findMessagesByTopic({
          topicId: dedicatedTopic.id,
          limit: 1,
          beforeId: m2.id
        });
        assert.strictEqual(page3.length, 1);
        assert.strictEqual(page3[0]?.id, m1.id, 'Page 3 doit renvoyer m1 sans le sauter');

        const page4 = await messageRepository.findMessagesByTopic({
          topicId: dedicatedTopic.id,
          limit: 1,
          beforeId: m1.id
        });
        assert.strictEqual(page4.length, 0, 'Page 4 après le dernier message doit être vide');
      } finally {
        await prisma.topic.delete({ where: { id: dedicatedTopic.id } });
      }
    });

    it('doit effectuer une suppression logique (softDeleteMessage sans supprimer la ligne)', async () => {
      // Suppression logique du deuxième message
      const updated = await messageRepository.softDeleteMessage(secondMessageId);
      assert.strictEqual(updated.isDeleted, true, 'isDeleted doit passer à true');

      // Vérifier que la ligne SQL existe toujours
      const stillInDb = await messageRepository.findMessageById(secondMessageId);
      assert.ok(stillInDb, 'Le message doit toujours exister en base');
      assert.strictEqual(stillInDb?.isDeleted, true, 'isDeleted doit être persistant en base');
      assert.strictEqual(stillInDb?.content, 'Deuxième message', 'Le contenu est conservé');
    });
  });
});

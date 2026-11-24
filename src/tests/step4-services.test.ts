import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MessageService } from '../services/message.service.js';
import type { MessageRepository } from '../repositories/message.repo.js';
import type { TopicRepository } from '../repositories/topic.repo.js';
import type { Message } from '../generated/prisma/client.js';

describe('Étape 4 : Tests Unitaires de MessageService (Fake Repositories & Spies)', () => {
  // Compteurs d'appels pour vérifier que les méthodes ne sont JAMAIS appelées en cas de refus
  let calls: {
    findMessagesByTopic: number;
    createMessage: number;
    softDeleteMessage: number;
    findMessageById: number;
    isParticipant: number;
    findTopicById: number;
  };

  // Données factices en mémoire
  let fakeTopics: Map<number, { exists: boolean; participants: Set<number> }>;
  let fakeMessages: Map<number, Message>;

  // Faux TopicRepository
  let fakeTopicRepo: Partial<TopicRepository>;
  // Faux MessageRepository
  let fakeMessageRepo: Partial<MessageRepository>;

  let service: MessageService;

  beforeEach(() => {
    calls = {
      findMessagesByTopic: 0,
      createMessage: 0,
      softDeleteMessage: 0,
      findMessageById: 0,
      isParticipant: 0,
      findTopicById: 0,
    };

    fakeTopics = new Map();
    fakeMessages = new Map();

    // Configuration d'un salon de test (ID: 1) avec les membres 10 et 20
    fakeTopics.set(1, {
      exists: true,
      participants: new Set([10, 20]),
    });

    fakeTopicRepo = {
      findTopicById: async (id: number) => {
        calls.findTopicById++;
        const topic = fakeTopics.get(id);
        if (!topic || !topic.exists) return null;
        return {
          id,
          serviceName: 'forum',
          title: 'Topic Test',
          createdAt: new Date(),
        };
      },
      isParticipant: async (topicId: number, userId: number) => {
        calls.isParticipant++;
        const topic = fakeTopics.get(topicId);
        if (!topic) return false;
        return topic.participants.has(userId);
      },
    };

    fakeMessageRepo = {
      findMessagesByTopic: async (query) => {
        calls.findMessagesByTopic++;
        return Array.from(fakeMessages.values()).filter((m) => m.topicId === query.topicId);
      },
      createMessage: async (input) => {
        calls.createMessage++;
        const newMsg: Message = {
          id: BigInt(fakeMessages.size + 1),
          topicId: input.topicId,
          senderId: input.senderId,
          content: input.content,
          isDeleted: false,
          createdAt: new Date(),
        };
        fakeMessages.set(Number(newMsg.id), newMsg);
        return newMsg;
      },
      findMessageById: async (id: bigint | number) => {
        calls.findMessageById++;
        return fakeMessages.get(Number(id)) ?? null;
      },
      softDeleteMessage: async (id: bigint | number) => {
        calls.softDeleteMessage++;
        const msg = fakeMessages.get(Number(id));
        if (!msg) throw new Error('Not found');
        msg.isDeleted = true;
        return msg;
      },
    };

    // Injection des faux repositories dans le service
    service = new MessageService(
      fakeMessageRepo as MessageRepository,
      fakeTopicRepo as TopicRepository
    );
  });

  // ===========================================================================
  // 1. LECTURE D'HISTORIQUE (getTopicMessages)
  // ===========================================================================
  describe('Lecture d\'historique (getTopicMessages)', () => {
    it('REFUS : l\'utilisateur non-participant ne doit pas pouvoir lire l\'historique et la méthode de lecture ne doit JAMAIS être appelée', async () => {
      // Utilisateur 99 n'est pas participant du topic 1
      await assert.rejects(
        () => service.getTopicMessages(1, 99, 50),
        /FORBIDDEN_NOT_PARTICIPANT/
      );

      // Vérification stricte : le repo de lecture n'a JAMAIS été sollicité
      assert.strictEqual(
        calls.findMessagesByTopic,
        0,
        'findMessagesByTopic ne doit JAMAIS être appelé pour un non-participant'
      );
    });

    it('REFUS : salon inexistant doit rejeter sans appeler la méthode de lecture', async () => {
      // Salon 999 n'existe pas
      await assert.rejects(
        () => service.getTopicMessages(999, 10, 50),
        /TOPIC_NOT_FOUND/
      );

      assert.strictEqual(
        calls.findMessagesByTopic,
        0,
        'findMessagesByTopic ne doit JAMAIS être appelé si le salon n\'existe pas'
      );
    });

    it('AUTORISÉ : un membre légitime peut lire l\'historique', async () => {
      // Ajout d'un message existant
      fakeMessages.set(1, {
        id: 1n,
        topicId: 1,
        senderId: 20,
        content: 'Bienvenue dans le salon',
        isDeleted: false,
        createdAt: new Date(),
      });

      // Utilisateur 10 est membre du salon 1
      const messages = await service.getTopicMessages(1, 10, 50);

      assert.strictEqual(calls.findMessagesByTopic, 1, 'findMessagesByTopic doit être appelé exactement 1 fois');
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0]?.content, 'Bienvenue dans le salon');
      assert.strictEqual(typeof messages[0]?.id, 'number', 'L\'ID doit être converti en number dans le DTO');
    });
  });

  // ===========================================================================
  // 2. ENVOI DE MESSAGE (postMessage)
  // ===========================================================================
  describe('Envoi de message (postMessage)', () => {
    it('REFUS : l\'utilisateur non-participant ne peut pas envoyer et createMessage ne doit JAMAIS être appelé', async () => {
      // Utilisateur 99 tente d'envoyer dans le topic 1
      await assert.rejects(
        () => service.postMessage(1, 99, 'Tentative non autorisée'),
        /FORBIDDEN_NOT_PARTICIPANT/
      );

      assert.strictEqual(
        calls.createMessage,
        0,
        'createMessage ne doit JAMAIS être appelé pour un non-participant'
      );
    });

    it('REFUS : envoi dans un salon inexistant ne doit JAMAIS appeler createMessage', async () => {
      await assert.rejects(
        () => service.postMessage(999, 10, 'Message salon fantôme'),
        /TOPIC_NOT_FOUND/
      );

      assert.strictEqual(
        calls.createMessage,
        0,
        'createMessage ne doit JAMAIS être appelé si le salon n\'existe pas'
      );
    });

    it('REFUS : message vide ne doit pas passer la vérification et ne doit JAMAIS appeler createMessage', async () => {
      await assert.rejects(
        () => service.postMessage(1, 10, '    '),
        /EMPTY_MESSAGE/
      );

      assert.strictEqual(
        calls.createMessage,
        0,
        'createMessage ne doit JAMAIS être appelé pour un contenu vide'
      );
    });

    it('AUTORISÉ : un membre peut envoyer un message valide', async () => {
      // Utilisateur 10 envoie un message dans le topic 1
      const dto = await service.postMessage(1, 10, '  Bonjour le monde !  ');

      assert.strictEqual(calls.createMessage, 1, 'createMessage doit être appelé exactement 1 fois');
      assert.strictEqual(dto.content, 'Bonjour le monde !', 'Le message doit être nettoyé avec trim()');
      assert.strictEqual(dto.senderId, 10);
      assert.strictEqual(dto.isDeleted, false);
    });
  });

  // ===========================================================================
  // 3. SUPPRESSION DE MESSAGE (deleteMessage)
  // ===========================================================================
  describe('Suppression de message (deleteMessage)', () => {
    beforeEach(() => {
      // Message appartenant à l'utilisateur 10
      fakeMessages.set(42, {
        id: 42n,
        topicId: 1,
        senderId: 10,
        content: 'Mon message original',
        isDeleted: false,
        createdAt: new Date(),
      });
    });

    it('REFUS : tentative de suppression par un autre utilisateur ne doit JAMAIS modifier le message', async () => {
      // Utilisateur 20 (ou 99) tente de supprimer le message 42 écrit par 10
      await assert.rejects(
        () => service.deleteMessage(42, 20),
        /FORBIDDEN_NOT_AUTHOR/
      );

      // Vérification stricte : softDeleteMessage n'a JAMAIS été appelé
      assert.strictEqual(
        calls.softDeleteMessage,
        0,
        'softDeleteMessage ne doit JAMAIS être appelé si l\'utilisateur n\'est pas l\'auteur'
      );

      // Le message en mémoire n'a pas été altéré
      assert.strictEqual(fakeMessages.get(42)?.isDeleted, false);
    });

    it('REFUS : suppression d\'un message inexistant ne doit JAMAIS appeler softDeleteMessage', async () => {
      await assert.rejects(
        () => service.deleteMessage(9999, 10),
        /MESSAGE_NOT_FOUND/
      );

      assert.strictEqual(
        calls.softDeleteMessage,
        0,
        'softDeleteMessage ne doit JAMAIS être appelé pour un message inexistant'
      );
    });

    it('AUTORISÉ : l\'auteur légitime peut supprimer son propre message', async () => {
      // Utilisateur 10 supprime son propre message 42
      const result = await service.deleteMessage(42, 10);

      assert.strictEqual(calls.softDeleteMessage, 1, 'softDeleteMessage doit être appelé exactement 1 fois');
      assert.strictEqual(result.isDeleted, true, 'isDeleted doit valoir true dans le DTO retourné');
      assert.strictEqual(fakeMessages.get(42)?.isDeleted, true, 'Le message doit être marqué isDeleted en base');
    });
  });
});

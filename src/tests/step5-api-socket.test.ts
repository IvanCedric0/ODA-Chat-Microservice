import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { io as createClient, type Socket } from 'socket.io-client';
import { buildServer } from '../server.js';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { mergeHistoryAndBuffer } from '../sockets/socket.handler.js';
import type {
  ClientToServerEvents,
  MessageDTO,
  ServerToClientEvents,
  TopicDTO,
} from '../../shared/contracts.js';

type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function signTestJwt(userId: number): string {
  return jwt.sign({ sub: userId, userId }, env.jwtSecret, { expiresIn: '1h' });
}

function waitForEvent<T>(
  socket: TypedClientSocket,
  event: keyof ServerToClientEvents,
  timeoutMs = 3000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as any);
      reject(new Error(`Timeout en attendant l'événement "${String(event)}"`));
    }, timeoutMs);

    const handler = (data: T) => {
      clearTimeout(timer);
      resolve(data);
    };

    socket.once(event, handler as any);
  });
}

function connectSocket(baseUrl: string, token?: string): Promise<TypedClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: TypedClientSocket = createClient(baseUrl, {
      auth: token !== undefined ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timeout connexion socket'));
    }, 3000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

describe('Étape 5 : Tests d\'Intégration API REST & Socket.io', () => {
  // ===========================================================================
  // 1. Tests unitaires purs de fusion/buffering (sans DB)
  // ===========================================================================
  describe('Fusion & Déduplication de join_topic (mergeHistoryAndBuffer)', () => {
    it('doit fusionner les nouveaux messages arrivés pendant le chargement d\'historique sans doublon', () => {
      const history: MessageDTO[] = [
        { id: 2, topicId: 1, senderId: 10, content: 'msg 2', isDeleted: false, createdAt: '2026-11-26T10:00:02.000Z' },
        { id: 1, topicId: 1, senderId: 10, content: 'msg 1', isDeleted: false, createdAt: '2026-11-26T10:00:01.000Z' },
      ];
      const buffered = [
        // Doublon déjà présent dans history
        { type: 'new_message' as const, payload: history[0]! },
        // Nouveau message arrivé après le snapshot DB
        {
          type: 'new_message' as const,
          payload: { id: 3, topicId: 1, senderId: 20, content: 'msg 3 live', isDeleted: false, createdAt: '2026-11-26T10:00:03.000Z' },
        },
      ];

      const merged = mergeHistoryAndBuffer(history, buffered);
      assert.strictEqual(merged.length, 3);
      assert.deepStrictEqual(merged.map((m) => m.id), [3, 2, 1]);
    });

    it('ne doit JAMAIS restaurer le texte d\'un message déjà supprimé via REST dans history', () => {
      const history: MessageDTO[] = [
        // Déjà soft-deleted en base quand la requête d'historique a tourné
        { id: 10, topicId: 1, senderId: 20, content: '', isDeleted: true, createdAt: '2026-11-26T10:00:00.000Z' },
      ];
      const buffered = [
        // Ancien new_message capturé dans le buffer avant le DELETE REST
        {
          type: 'new_message' as const,
          payload: { id: 10, topicId: 1, senderId: 20, content: 'texte secret supprimé', isDeleted: false, createdAt: '2026-11-26T10:00:00.000Z' },
        },
      ];

      const merged = mergeHistoryAndBuffer(history, buffered);
      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0]?.isDeleted, true);
      assert.strictEqual(merged[0]?.content, '');
    });

    it('doit appliquer message_deleted bufferisé sur un message arrivé pendant le join', () => {
      const history: MessageDTO[] = [];
      const buffered = [
        {
          type: 'new_message' as const,
          payload: { id: 15, topicId: 1, senderId: 20, content: 'éphémère', isDeleted: false, createdAt: '2026-11-26T10:00:05.000Z' },
        },
        { type: 'message_deleted' as const, payload: { topicId: 1, messageId: 15 } },
      ];

      const merged = mergeHistoryAndBuffer(history, buffered);
      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0]?.isDeleted, true);
      assert.strictEqual(merged[0]?.content, '');
    });
  });

  // ===========================================================================
  // 2. Tests d'Intégration HTTP (fastify.inject) & Socket.io (avec PostgreSQL)
  // ===========================================================================
  describe('API REST & Passerelle Temps Réel (PostgreSQL requis)', () => {
    let serverContext: Awaited<ReturnType<typeof buildServer>>;
    let baseUrl: string;
    let createdTopicId: number | null = null;
    let restMessageId: number | null = null;
    const activeSockets: TypedClientSocket[] = [];

    before(async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch (err: any) {
        throw new Error(
          `Impossible de se connecter à PostgreSQL (${err.message}). ` +
          `Assurez-vous que Docker tourne bien avec "docker compose up -d".`
        );
      }

      serverContext = await buildServer({ logger: false });
      baseUrl = await serverContext.fastify.listen({ port: 0, host: '127.0.0.1' });
    });

    after(async () => {
      for (const s of activeSockets) {
        if (s.connected) s.disconnect();
      }
      if (createdTopicId) {
        try {
          await prisma.topic.delete({ where: { id: createdTopicId } });
        } catch {
          // Ignorer si déjà supprimé
        }
      }
      if (serverContext) {
        await serverContext.fastify.close();
      }
      await prisma.$disconnect();
    });

    it('GET /health doit retourner 200 et GET /embed/ doit inclure la CSP frame-ancestors', async () => {
      const healthRes = await serverContext.fastify.inject({ method: 'GET', url: '/health' });
      assert.strictEqual(healthRes.statusCode, 200);
      assert.strictEqual(healthRes.json().status, 'ok');

      const embedRes = await serverContext.fastify.inject({ method: 'GET', url: '/embed/?topicId=1' });
      assert.strictEqual(embedRes.statusCode, 200);
      assert.match(String(embedRes.headers['content-security-policy']), /frame-ancestors 'self'/);
    });

    it('POST /api/v1/topics doit rejeter sans x-service-key (401) puis créer avec la bonne clé (201)', async () => {
      const unauth = await serverContext.fastify.inject({
        method: 'POST',
        url: '/api/v1/topics',
        payload: { serviceName: 'forum', title: 'Test Step 5', participantIds: [101, 102] },
      });
      assert.strictEqual(unauth.statusCode, 401);

      const createdRes = await serverContext.fastify.inject({
        method: 'POST',
        url: '/api/v1/topics',
        headers: { 'x-service-key': env.serviceKey },
        payload: { serviceName: 'forum', title: 'Test Step 5', participantIds: [101, 102] },
      });
      assert.strictEqual(createdRes.statusCode, 201);

      const topic = createdRes.json() as TopicDTO;
      assert.ok(topic.id > 0);
      assert.deepStrictEqual(topic.participantIds.sort((a, b) => a - b), [101, 102]);
      createdTopicId = topic.id;
    });

    it('GET /api/v1/topics/:topicId/messages doit valider auth, bornes limit/params et autorisations', async () => {
      assert.ok(createdTopicId);

      // 400 sur limit > 100
      const badLimit = await serverContext.fastify.inject({
        method: 'GET',
        url: `/api/v1/topics/${createdTopicId}/messages?limit=1000000`,
      });
      assert.strictEqual(badLimit.statusCode, 400);

      // 400 sur topicId = 0
      const badTopic = await serverContext.fastify.inject({
        method: 'GET',
        url: '/api/v1/topics/0/messages',
      });
      assert.strictEqual(badTopic.statusCode, 400);

      // 401 sans JWT
      const noJwt = await serverContext.fastify.inject({
        method: 'GET',
        url: `/api/v1/topics/${createdTopicId}/messages`,
      });
      assert.strictEqual(noJwt.statusCode, 401);

      // 403 pour utilisateur non-membre (#999)
      const forbidden = await serverContext.fastify.inject({
        method: 'GET',
        url: `/api/v1/topics/${createdTopicId}/messages`,
        headers: { authorization: `Bearer ${signTestJwt(999)}` },
      });
      assert.strictEqual(forbidden.statusCode, 403);

      // 200 pour membre légitime (#101)
      const ok = await serverContext.fastify.inject({
        method: 'GET',
        url: `/api/v1/topics/${createdTopicId}/messages`,
        headers: { authorization: `Bearer ${signTestJwt(101)}` },
      });
      assert.strictEqual(ok.statusCode, 200);
      assert.ok(Array.isArray(ok.json()));
    });

    it('Socket.io doit rejeter les connexions sans JWT ou avec un JWT invalide', async () => {
      await assert.rejects(() => connectSocket(baseUrl), /Missing token/i);
      await assert.rejects(() => connectSocket(baseUrl, 'invalid.jwt.token'), /Invalid token/i);
    });

    it('Socket.io doit refuser join_topic pour un non-membre et gérer les payloads invalides sans crash', async () => {
      assert.ok(createdTopicId);
      const outsider = await connectSocket(baseUrl, signTestJwt(999));
      activeSockets.push(outsider);

      const errPromise = waitForEvent<{ code: string; message: string }>(outsider, 'error_event');
      outsider.emit('join_topic', { topicId: createdTopicId });
      const errEvent = await errPromise;
      assert.strictEqual(errEvent.code, 'FORBIDDEN_NOT_PARTICIPANT');

      const badPayloadPromise = waitForEvent<{ code: string; message: string }>(outsider, 'error_event');
      outsider.emit('send_message', null as any);
      const badPayloadErr = await badPayloadPromise;
      assert.strictEqual(badPayloadErr.code, 'INVALID_PAYLOAD');

      outsider.disconnect();
    });

    it('Socket.io doit diffuser new_message, synchroniser DELETE REST -> message_deleted, et expulser un participant retiré', async () => {
      assert.ok(createdTopicId);

      const socket101 = await connectSocket(baseUrl, signTestJwt(101));
      const socket102 = await connectSocket(baseUrl, signTestJwt(102));
      activeSockets.push(socket101, socket102);

      // 1. Les deux membres rejoignent le salon
      const joined101 = waitForEvent<{ topicId: number; history: MessageDTO[] }>(socket101, 'room_joined');
      const joined102 = waitForEvent<{ topicId: number; history: MessageDTO[] }>(socket102, 'room_joined');
      socket101.emit('join_topic', { topicId: createdTopicId });
      socket102.emit('join_topic', { topicId: createdTopicId });
      assert.strictEqual((await joined101).topicId, createdTopicId);
      assert.strictEqual((await joined102).topicId, createdTopicId);

      // 2. User 101 envoie un message -> reçu par 101 ET 102
      const msgFor101 = waitForEvent<MessageDTO>(socket101, 'new_message');
      const msgFor102 = waitForEvent<MessageDTO>(socket102, 'new_message');
      socket101.emit('send_message', { topicId: createdTopicId, content: 'Hello Step 5!' });

      const [received101, received102] = await Promise.all([msgFor101, msgFor102]);
      assert.strictEqual(received101.content, 'Hello Step 5!');
      assert.strictEqual(received102.id, received101.id);
      assert.strictEqual(received101.senderId, 101);
      restMessageId = received101.id;

      // 3. User 102 ne peut pas supprimer le message de 101 (REST -> 403)
      const forbiddenDel = await serverContext.fastify.inject({
        method: 'DELETE',
        url: `/api/v1/messages/${restMessageId}`,
        headers: { authorization: `Bearer ${signTestJwt(102)}` },
      });
      assert.strictEqual(forbiddenDel.statusCode, 403);

      // 4. User 101 supprime via REST -> 200 ET socket 102 reçoit message_deleted en temps réel
      const deletedEvent102 = waitForEvent<{ topicId: number; messageId: number }>(socket102, 'message_deleted');
      const okDel = await serverContext.fastify.inject({
        method: 'DELETE',
        url: `/api/v1/messages/${restMessageId}`,
        headers: { authorization: `Bearer ${signTestJwt(101)}` },
      });
      assert.strictEqual(okDel.statusCode, 200);
      assert.strictEqual(okDel.json().isDeleted, true);
      assert.strictEqual(okDel.json().content, '');

      const wsDeleted = await deletedEvent102;
      assert.strictEqual(wsDeleted.topicId, createdTopicId);
      assert.strictEqual(wsDeleted.messageId, restMessageId);

      // 5. Retrait du participant 102 -> son socket est expulsé et ne reçoit plus les messages suivants
      const evictedPromise = waitForEvent<{ code: string; message: string }>(socket102, 'error_event');
      const removeRes = await serverContext.fastify.inject({
        method: 'DELETE',
        url: `/api/v1/topics/${createdTopicId}/participants/102`,
        headers: { 'x-service-key': env.serviceKey },
      });
      assert.strictEqual(removeRes.statusCode, 200);
      assert.strictEqual((await evictedPromise).code, 'REMOVED_FROM_TOPIC');

      let receivedAfterEviction = false;
      socket102.once('new_message', () => {
        receivedAfterEviction = true;
      });

      const msgAfterEviction = waitForEvent<MessageDTO>(socket101, 'new_message');
      socket101.emit('send_message', { topicId: createdTopicId, content: 'Secret après retrait' });
      assert.strictEqual((await msgAfterEviction).content, 'Secret après retrait');

      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(receivedAfterEviction, false, 'Le membre expulsé ne doit plus recevoir de messages');
    });
  });
});

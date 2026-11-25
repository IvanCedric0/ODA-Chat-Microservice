import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketServer } from 'socket.io';
import { env } from './config/env.js';
import { prisma as defaultPrisma } from './config/prisma.js';

type ChatPrisma = typeof defaultPrisma;

export const buildChatServer = (database: ChatPrisma = defaultPrisma) => {
  const app = Fastify({ logger: false });
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(__dirname, '../public');

  const authenticateRequest = async (request: any, reply: any) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const payload = jwt.verify(authorization.slice(7), env.jwtSecret) as {
        sub?: string;
        userId?: number;
      };
      const userId = payload.userId ?? Number(payload.sub);
      if (!Number.isInteger(userId)) {
        return reply.code(401).send({ error: 'Invalid token' });
      }
      request.userId = userId;
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  };

  const requireTopicParticipant = async (request: any, reply: any) => {
    const topicId = Number(request.params.id);
    const participant = await database.topicParticipant.findUnique({
      where: {
        topicId_userId: {
          topicId,
          userId: request.userId,
        },
      },
    });
    if (!participant) {
      return reply.code(403).send({ error: 'Topic access denied' });
    }
  };

  app.register(cors, {
    origin: env.allowedOrigins,
    credentials: true,
  });
  app.register(swagger, {
    openapi: { info: { title: 'ODA Chat Service', version: '1.0.0' } },
  });
  app.register(swaggerUi, { routePrefix: '/docs' });
  app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/embed/',
    decorateReply: false,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/api/v1/topics', async (request, reply) => {
    const body = request.body as {
      service_name?: string;
      title?: string;
      participant_ids?: number[];
    };

    if (!body.service_name || !body.title || !Array.isArray(body.participant_ids)) {
      return reply.code(400).send({ error: 'Invalid topic payload' });
    }

    const topic = await database.topic.create({
      data: {
        serviceName: body.service_name,
        title: body.title,
        participants: {
          create: body.participant_ids.map((userId) => ({ userId })),
        },
      },
    });
    return reply.code(201).send({
      id: topic.id,
      embed_url: `${env.allowedOrigins[0]}/embed/?topicId=${topic.id}`,
    });
  });

  app.post('/api/v1/topics/:id/participants', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { user_ids } = request.body as { user_ids?: number[] };
    if (!Array.isArray(user_ids)) {
      return reply.code(400).send({ error: 'Invalid participant payload' });
    }
    await database.topicParticipant.createMany({
      data: user_ids.map((userId) => ({ topicId: Number(id), userId })),
      skipDuplicates: true,
    });
    return reply.code(204).send();
  });

  app.delete('/api/v1/topics/:id/participants/:uid', async (request) => {
    const { id, uid } = request.params as { id: string; uid: string };
    await database.topicParticipant.delete({
      where: {
        topicId_userId: { topicId: Number(id), userId: Number(uid) },
      },
    });
    return { deleted: true };
  });

  app.get('/api/v1/topics/:id/messages', {
    preHandler: [authenticateRequest, requireTopicParticipant],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { limit = '50', before_id } = request.query as {
      limit?: string;
      before_id?: string;
    };
    const messages = await database.message.findMany({
      where: {
        topicId: Number(id),
        isDeleted: false,
        ...(before_id ? { id: { lt: BigInt(before_id) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: Math.min(Number(limit) || 50, 100),
    });
    return messages.reverse().map((message) => ({
      id: Number(message.id),
      topic_id: message.topicId,
      sender_id: message.senderId,
      content: message.content,
      created_at: message.createdAt,
    }));
  });

  app.delete('/api/v1/messages/:id', {
    preHandler: [authenticateRequest],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const messageRecord = await database.message.findUnique({
      where: { id: BigInt(id) },
    });
    if (!messageRecord) {
      return reply.code(404).send({ error: 'Message not found' });
    }
    if (messageRecord.senderId !== (request as any).userId) {
      return reply.code(403).send({ error: 'Cannot delete another user message' });
    }
    const message = await database.message.update({
      where: { id: messageRecord.id },
      data: { isDeleted: true },
    });
    return { id: Number(message.id), deleted: true };
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/socket.io/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  const io = new SocketServer(app.server, {
    cors: { origin: env.allowedOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, env.jwtSecret) as {
        sub?: string;
        userId?: number;
      };
      const userId = payload.userId ?? Number(payload.sub);
      if (!Number.isInteger(userId)) return next(new Error('Invalid token'));
      socket.data.userId = userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const topicId = Number(socket.handshake.auth?.topicId);
    if (!Number.isInteger(topicId) || topicId <= 0) {
      socket.disconnect(true);
      return;
    }

    database.topicParticipant
      .findUnique({
        where: {
          topicId_userId: { topicId, userId: socket.data.userId },
        },
      })
      .then((participant) => {
        if (!participant) {
          socket.disconnect(true);
          return;
        }
        socket.join(`topic_${topicId}`);
        socket.on('send_message', async (
          payload: { content?: string },
          acknowledge?: (response: { ok: boolean; error?: string }) => void,
        ) => {
          const content = payload.content?.trim();
          if (!content || content.length > 500) {
            acknowledge?.({ ok: false, error: 'Le message doit contenir entre 1 et 500 caractères.' });
            return;
          }
          try {
            const message = await database.message.create({
              data: {
                topicId,
                senderId: socket.data.userId,
                content,
              },
            });
            io.to(`topic_${topicId}`).emit('new_message', {
              id: Number(message.id),
              topic_id: topicId,
              sender_id: message.senderId,
              content: message.content,
              created_at: message.createdAt,
            });
            acknowledge?.({ ok: true });
          } catch {
            acknowledge?.({ ok: false, error: "L'envoi du message a échoué." });
          }
        });
        socket.on('delete_message', async (payload: { message_id?: number }) => {
          if (!payload.message_id) return;
          const message = await database.message.findUnique({
            where: { id: BigInt(payload.message_id) },
          });
          if (!message || message.topicId !== topicId || message.senderId !== socket.data.userId) {
            return;
          }
          await database.message.update({
            where: { id: message.id },
            data: { isDeleted: true },
          });
          io.to(`topic_${topicId}`).emit('message_deleted', {
            message_id: payload.message_id,
          });
        });
      })
      .catch(() => socket.disconnect(true));
  });

  return { app, io };
};

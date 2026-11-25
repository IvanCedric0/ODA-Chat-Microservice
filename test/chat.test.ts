import jwt from 'jsonwebtoken';
import { io as createClientSocket, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://chat_test:chat_test@localhost:5432/chat_test';
process.env.JWT_SECRET = 'test-secret';

let buildChatServer: typeof import('../src/app.js').buildChatServer;
let app: Awaited<ReturnType<typeof import('../src/app.js')['buildChatServer']>>['app'];
let ioServer: Awaited<ReturnType<typeof import('../src/app.js')['buildChatServer']>>['io'];
let baseUrl = '';
let sockets: Socket[] = [];

const mockPrisma = {
  topic: {
    create: vi.fn(),
  },
  topicParticipant: {
    findUnique: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

beforeAll(async () => {
  ({ buildChatServer } = await import('../src/app.js'));
  mockPrisma.topicParticipant.findUnique.mockImplementation(
    ({ where }: { where: { topicId_userId: { topicId: number; userId: number } } }) =>
      Promise.resolve(
        where.topicId_userId.userId === 999
          ? null
          : { topicId: 42, userId: where.topicId_userId.userId },
      ),
  );
  mockPrisma.message.findMany.mockResolvedValue([
    {
      id: 2n,
      topicId: 42,
      senderId: 10,
      content: 'Bonjour',
      createdAt: new Date('2026-11-25T08:00:00.000Z'),
    },
  ]);
  mockPrisma.message.create.mockResolvedValue({
    id: 3n,
    topicId: 42,
    senderId: 10,
    content: 'Test socket',
    createdAt: new Date('2026-11-25T09:00:00.000Z'),
  });
  mockPrisma.message.findUnique.mockResolvedValue({
    id: 3n,
    topicId: 42,
    senderId: 10,
    content: 'Test socket',
    isDeleted: false,
  });
  mockPrisma.message.update.mockResolvedValue({
    id: 3n,
    isDeleted: true,
  });

  const server = buildChatServer(
    mockPrisma as unknown as Parameters<typeof buildChatServer>[0],
  );
  app = server.app;
  ioServer = server.io;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  ioServer.close();
  await app.close();
});

const connectSocket = (userId: number, topicId = 42) =>
  new Promise<Socket>((resolve, reject) => {
    const token = jwt.sign({ userId, sub: String(userId) }, 'test-secret');
    const socket = createClientSocket(baseUrl, {
      transports: ['websocket'],
      auth: { token, topicId },
      reconnection: false,
    });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

describe('historique REST', () => {
  it('refuse une requête sans JWT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/topics/42/messages',
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuse un JWT invalide', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/topics/42/messages',
      headers: { authorization: 'Bearer invalid-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuse un JWT expiré', async () => {
    const token = jwt.sign({ userId: 10, sub: '10' }, 'test-secret', { expiresIn: -1 });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/topics/42/messages',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('retourne l’historique à un participant', async () => {
    const token = jwt.sign({ userId: 10, sub: '10' }, 'test-secret');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/topics/42/messages',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: 2,
        topic_id: 42,
        sender_id: 10,
        content: 'Bonjour',
        created_at: '2026-11-25T08:00:00.000Z',
      },
    ]);
  });

  it('refuse l’historique à un non-participant', async () => {
    const token = jwt.sign({ userId: 999, sub: '999' }, 'test-secret');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/topics/42/messages',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('protège la création de salon par JWT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/topics',
      payload: {
        service_name: 'forum',
        title: 'Test',
        participant_ids: [10],
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('protège l’ajout de participants', async () => {
    const token = jwt.sign({ userId: 10, sub: '10' }, 'test-secret');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/topics/42/participants',
      headers: { authorization: `Bearer ${token}` },
      payload: { user_ids: [11] },
    });
    expect(response.statusCode).toBe(204);
  });

  it('refuse l’ajout de participants invalides', async () => {
    const token = jwt.sign({ userId: 10, sub: '10' }, 'test-secret');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/topics/42/participants',
      headers: { authorization: `Bearer ${token}` },
      payload: { user_ids: [-1] },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('messages Socket.io', () => {
  it('rejette une connexion Socket.io sans JWT', async () => {
    await expect(
      new Promise<void>((resolve) => {
        const socket = createClientSocket(baseUrl, {
          transports: ['websocket'],
          auth: { topicId: 42 },
          reconnection: false,
        });
        sockets.push(socket);
        socket.once('connect_error', () => resolve());
      }),
    ).resolves.toBeUndefined();
  });
  it('rejette un utilisateur non participant', async () => {
    const token = jwt.sign({ userId: 999, sub: '999' }, 'test-secret');
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = createClientSocket(baseUrl, {
          transports: ['websocket'],
          auth: { token, topicId: 42 },
          reconnection: false,
        });
        sockets.push(socket);
        socket.once('connect', () => {
          socket.once('disconnect', () => resolve());
        });
        socket.once('disconnect', () => resolve());
        socket.once('connect_error', () => resolve());
      }),
    ).resolves.toBeUndefined();
  });

  it('envoie un message valide avec accusé de réception', async () => {
    const socket = await connectSocket(10);
    const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit('send_message', { content: 'Test socket' }, resolve);
    });
    expect(response).toEqual({ ok: true });
    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: {
        topicId: 42,
        senderId: 10,
        content: 'Test socket',
      },
    });
  });

  it('rejette un message vide ou supérieur à 500 caractères', async () => {
    const socket = await connectSocket(10);

    const emptyResponse = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit('send_message', { content: '   ' }, resolve);
    });
    const longResponse = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit('send_message', { content: 'a'.repeat(501) }, resolve);
    });

    expect(emptyResponse.ok).toBe(false);
    expect(longResponse.ok).toBe(false);
  });

  it('diffuse la suppression par son auteur', async () => {
    const socket = await connectSocket(10);
    const deletedEvent = new Promise<number>((resolve) => {
      socket.once('message_deleted', ({ message_id }) => resolve(message_id));
    });

    socket.emit('delete_message', { message_id: 3 });
    await expect(deletedEvent).resolves.toBe(3);
  });
});

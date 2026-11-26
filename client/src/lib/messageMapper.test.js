import assert from 'node:assert/strict';
import test from 'node:test';
import { mapMessageDTO } from './messageMapper.js';

test('maps MessageDTO author and timestamp for history and live messages', () => {
  const message = {
    id: 17,
    topicId: 1,
    senderId: 35,
    content: 'Bonjour',
    isDeleted: false,
    createdAt: '2026-11-25T12:00:00.000Z',
  };

  assert.deepEqual(mapMessageDTO(message), {
    id: 17,
    text: 'Bonjour',
    userId: 35,
    timestamp: '2026-11-25T12:00:00.000Z',
  });
});

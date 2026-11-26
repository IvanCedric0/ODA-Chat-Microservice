import assert from 'node:assert/strict';
import test from 'node:test';
import { sendChatMessage } from './socket.js';

const createSocket = () => {
  const listeners = new Map();
  const emitted = [];
  return {
    connected: true,
    emitted,
    on(event, listener) {
      listeners.set(event, listener);
    },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    receive(event, payload) {
      listeners.get(event)?.(payload);
    },
  };
};

test('confirms a send only when its matching new_message event arrives', async () => {
  const socket = createSocket();
  const resultPromise = sendChatMessage(socket, 'Bonjour', 12, 34);

  assert.deepEqual(socket.emitted, [
    { event: 'send_message', payload: { topicId: 12, content: 'Bonjour' } },
  ]);

  socket.receive('new_message', {
    topicId: 12,
    senderId: 99,
    content: 'Bonjour',
  });
  socket.receive('new_message', {
    topicId: 12,
    senderId: 34,
    content: 'Autre message',
  });

  let settled = false;
  resultPromise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  socket.receive('new_message', {
    topicId: 12,
    senderId: 34,
    content: 'Bonjour',
  });

  assert.deepEqual(await resultPromise, { ok: true });
});

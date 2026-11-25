import { io } from 'socket.io-client';

/**
 * @param {string} token
 * @returns {import('socket.io-client').Socket<
 *   import('../../../shared/contracts').ServerToClientEvents,
 *   import('../../../shared/contracts').ClientToServerEvents
 * >}
 */

export function createChatSocket(token, topicId) {
  return io({
    auth: { token, topicId },
    autoConnect: false,
  });
}
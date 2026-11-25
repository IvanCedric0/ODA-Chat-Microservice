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

export const sendChatMessage = (socket, content) => {
  if (!socket?.connected) {
    return Promise.resolve({ ok: false, error: 'Vous êtes déconnecté.' });
  }

  return new Promise((resolve) => {
    socket.timeout(10000).emit('send_message', { content }, (timeoutError, response) => {
      if (timeoutError) {
        resolve({ ok: false, error: 'Le serveur ne confirme pas l’envoi. Réessayez.' });
      } else {
        resolve(response || { ok: false, error: "L'envoi du message a échoué." });
      }
    });
  });
};
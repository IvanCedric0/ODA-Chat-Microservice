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

export const sendChatMessage = (socket, content, topicId, senderId) => {
  if (!socket?.connected) {
    return Promise.resolve({ ok: false, error: 'Vous êtes déconnecté.' });
  }

  if (!Number.isInteger(topicId) || !Number.isInteger(senderId)) {
    return Promise.resolve({ ok: false, error: "Impossible de confirmer l'envoi du message." });
  }

  return new Promise((resolve) => {
    let timeoutId;
    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off('new_message', onMessage);
      socket.off('error_event', onError);
    };
    const finish = (result) => {
      cleanup();
      resolve(result);
    };
    const onMessage = (message) => {
      if (
        message.topicId === topicId
        && message.senderId === senderId
        && message.content === content
      ) {
        finish({ ok: true });
      }
    };
    const onError = ({ message }) => {
      finish({ ok: false, error: message || "L'envoi du message a échoué." });
    };

    socket.on('new_message', onMessage);
    socket.on('error_event', onError);
    timeoutId = setTimeout(() => {
      finish({ ok: false, error: 'Le serveur ne confirme pas l’envoi. Réessayez.' });
    }, 10000);
    socket.emit('send_message', { topicId, content });
  });
};
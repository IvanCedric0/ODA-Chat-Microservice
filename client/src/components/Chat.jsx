import React, { useCallback, useState, useEffect, useLayoutEffect, useRef } from 'react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import UserList from './UserList';
import { createHistoryQuery, getOldestMessageId } from '../lib/historyPagination';
import { createChatSocket, sendChatMessage } from '../lib/socket';
import { mapMessageDTO } from '../lib/messageMapper';
import {
  getParentOrigin,
  getTrustedOnlineUsers,
  isTrustedAuthMessage,
  parseAllowedParentOrigins,
} from '../lib/chatAuth';
import './Chat.css';

const allowedParentOrigins = parseAllowedParentOrigins(
  import.meta.env.VITE_CHAT_PARENT_ORIGINS || '',
);

const decodePayload = (jwt) => {
  try {
    const payload = jwt.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(base64));
  } catch {
    return {};
  }
};

const Chat = () => {
  const HISTORY_PAGE_SIZE = 50;
  const initialParams = new URLSearchParams(window.location.search);
  const initialTopicId = Number(initialParams.get('topicId'));
  const tokenInUrl = initialParams.has('token');
  const hasValidTopic = Number.isInteger(initialTopicId) && initialTopicId > 0;
  const parentOrigin = window.parent === window ? '' : getParentOrigin(document.referrer);
  const isAllowedParentOrigin = allowedParentOrigins.includes(parentOrigin);
  const [authToken, setAuthToken] = useState(null);
  const authPayload = authToken ? decodePayload(authToken) : {};
  const authUserId = authPayload.userId ?? Number(authPayload.sub);

  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [hasPresenceData, setHasPresenceData] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [connectionError, setConnectionError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [pendingDeleteIds, setPendingDeleteIds] = useState([]);
  const [hasLeft, setHasLeft] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState(
    tokenInUrl
      ? 'Le token fourni dans l’URL a été ignoré. Le chat attend le token sécurisé de l’application hôte.'
      : '',
  );

  const messageListRef = useRef(null);
  const socketRef = useRef(null);
  const hostOriginRef = useRef(null);
  const retryHistoryRef = useRef(null);
  const pendingDeleteTimeoutsRef = useRef(new Map());
  const isLeavingRef = useRef(false);
  const historyCursorRef = useRef(null);
  const loadOlderRef = useRef(null);
  const isLoadingOlderRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const scrollRestoreRef = useRef(null);

  const notifyHostPresence = useCallback((type) => {
    if (
      window.parent !== window
      && hostOriginRef.current
      && Number.isInteger(authUserId)
    ) {
      window.parent.postMessage(
        { type, topicId: initialTopicId, userId: authUserId },
        hostOriginRef.current,
      );
    }
  }, [authUserId, initialTopicId]);

  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list) return;

    if (scrollRestoreRef.current) {
      const { scrollHeight, scrollTop } = scrollRestoreRef.current;
      list.scrollTop = scrollTop + list.scrollHeight - scrollHeight;
      scrollRestoreRef.current = null;
    } else if (isNearBottomRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('token')) {
      url.searchParams.delete('token');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    if (!hasValidTopic || !isAllowedParentOrigin) return undefined;

    const handleHostMessage = (event) => {
      if (isTrustedAuthMessage(event, allowedParentOrigins, window.parent)) {
        hostOriginRef.current = event.origin;
        setAuthToken(event.data.token);
        setAuthError('');
        setIsLoading(true);
        setError('');
        setConnectionState('connecting');
        return;
      }

      const users = getTrustedOnlineUsers(event, allowedParentOrigins, window.parent);
      if (users !== null) {
        hostOriginRef.current = event.origin;
        setOnlineUsers(users);
        setHasPresenceData(true);
      }
    };

    window.addEventListener('message', handleHostMessage);
    window.parent.postMessage({ type: 'CHAT_READY' }, parentOrigin);

    return () => window.removeEventListener('message', handleHostMessage);
  }, [hasValidTopic, isAllowedParentOrigin, parentOrigin]);

  useEffect(() => {
    if (!hasValidTopic || !authToken) return undefined;

    const topicId = initialTopicId;
    const token = authToken;

    let isMounted = true;
    const pendingDeleteTimeouts = pendingDeleteTimeoutsRef.current;

    isLeavingRef.current = false;

    const loadHistoryPage = async (beforeId, prepend = false) => {
      if (prepend && (isLoadingOlderRef.current || !historyCursorRef.current)) return;
      if (prepend) {
        isLoadingOlderRef.current = true;
        setIsLoadingOlder(true);
        setHistoryError('');
      }

      try {
        const query = createHistoryQuery(HISTORY_PAGE_SIZE, beforeId);
        const response = await fetch(`/api/v1/topics/${topicId}/messages?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Impossible de charger l’historique (${response.status}).`);
        }
        const history = await response.json();
        if (!isMounted) return;

        const page = history.map(mapMessageDTO);
        const oldestMessageId = getOldestMessageId(page);
        if (oldestMessageId !== null) historyCursorRef.current = oldestMessageId;
        setHasMoreHistory(page.length === HISTORY_PAGE_SIZE);
        if (prepend && messageListRef.current) {
          scrollRestoreRef.current = {
            scrollHeight: messageListRef.current.scrollHeight,
            scrollTop: messageListRef.current.scrollTop,
          };
        }
        setMessages((previous) => {
          const unique = new Map(previous.map((message) => [message.id, message]));
          page.forEach((message) => unique.set(message.id, message));
          return Array.from(unique.values()).sort((a, b) => a.id - b.id);
        });
      } catch (loadError) {
        if (isMounted) {
          if (prepend) setHistoryError(loadError.message);
          else setError(loadError.message);
        }
      } finally {
        if (prepend) {
          isLoadingOlderRef.current = false;
          if (isMounted) setIsLoadingOlder(false);
        } else if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadOlderRef.current = () => loadHistoryPage(historyCursorRef.current, true);
    retryHistoryRef.current = () => {
      setIsLoading(true);
      setError('');
      return loadHistoryPage(null);
    };
    loadHistoryPage(null);

    const socket = createChatSocket(token, topicId);
    socketRef.current = socket;

    socket.on('connect', () => {
      if (isMounted) {
        setConnectionState('connected');
        setConnectionError('');
        notifyHostPresence('CHAT_JOIN');
      }
    });
    socket.on('disconnect', (reason) => {
      if (!isMounted) return;
      if (isLeavingRef.current) {
        setConnectionState('disconnected');
      } else {
        setConnectionState(reason === 'io server disconnect' ? 'disconnected' : 'reconnecting');
      }
    });
    socket.on('connect_error', (socketError) => {
      if (isMounted) {
        setConnectionState('reconnecting');
        setConnectionError(socketError.message || 'Connexion au chat impossible.');
      }
    });
    const onReconnectAttempt = () => {
      if (isMounted) setConnectionState('reconnecting');
    };
    const onReconnectFailed = () => {
      if (isMounted) {
        setConnectionState('disconnected');
        setConnectionError('Reconnexion impossible. Réessayez manuellement.');
      }
    };
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect_failed', onReconnectFailed);
    socket.on('new_message', (message) => {
      if (!isMounted) return;
      setMessages((previous) => {
        if (previous.some((item) => item.id === message.id)) return previous;
        return [...previous, mapMessageDTO(message)];
      });
    });
    socket.on('message_deleted', ({ message_id }) => {
      if (isMounted) {
        const timer = pendingDeleteTimeoutsRef.current.get(message_id);
        if (timer !== undefined) window.clearTimeout(timer);
        pendingDeleteTimeoutsRef.current.delete(message_id);
        setPendingDeleteIds((previous) => previous.filter((id) => id !== message_id));
        setMessages((previous) => previous.filter((message) => message.id !== message_id));
        setDeleteError('');
      }
    });

    socket.connect();

    return () => {
      isMounted = false;
      loadOlderRef.current = null;
      retryHistoryRef.current = null;
      pendingDeleteTimeouts.forEach((timer) => window.clearTimeout(timer));
      pendingDeleteTimeouts.clear();
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.off();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [authToken, initialTopicId, hasValidTopic, notifyHostPresence]);

  const handleMessageListScroll = (event) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
    if (scrollTop < 80 && hasMoreHistory && !isLoadingOlderRef.current) {
      loadOlderRef.current?.();
    }
  };

  const handleLoadOlder = () => {
    loadOlderRef.current?.();
  };

  const handleSendMessage = (messageText) => {
    if (!messageText.trim()) return { ok: false, error: 'Le message est vide.' };
    return sendChatMessage(socketRef.current, messageText.trim());
  };

  const handleDeleteMessage = (messageId) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setDeleteError('Impossible de supprimer le message : vous êtes déconnecté.');
      return;
    }
    if (pendingDeleteTimeoutsRef.current.has(messageId)) return;
    if (!window.confirm('Voulez-vous vraiment supprimer ce message ? Cette action est irréversible.')) {
      return;
    }

    setDeleteError('');
    setPendingDeleteIds((previous) => [...previous, messageId]);
    const timer = window.setTimeout(() => {
      pendingDeleteTimeoutsRef.current.delete(messageId);
      setPendingDeleteIds((previous) => previous.filter((id) => id !== messageId));
      setDeleteError('La suppression n’a pas été confirmée. Vérifiez la connexion et réessayez.');
    }, 8000);
    pendingDeleteTimeoutsRef.current.set(messageId, timer);
    socket.emit('delete_message', { message_id: messageId });
  };

  const handleLeave = () => {
    isLeavingRef.current = true;
    socketRef.current?.disconnect();
    pendingDeleteTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
    pendingDeleteTimeoutsRef.current.clear();
    setPendingDeleteIds([]);
    setConnectionState('disconnected');
    setHasLeft(true);
    notifyHostPresence('CHAT_LEAVE');
  };

  const handleReconnect = () => {
    if (!socketRef.current || connectionState === 'reconnecting') return;
    setConnectionError('');
    setConnectionState('connecting');
    socketRef.current.connect();
  };

  const isConnected = connectionState === 'connected';
  const currentUser = Number.isInteger(authUserId)
    ? onlineUsers.find((user) => user.id === authUserId)
      || { id: authUserId, name: `Utilisateur ${authUserId}` }
    : null;
  const connectionLabel = {
    connecting: 'Connexion...',
    connected: 'Connecté',
    reconnecting: 'Reconnexion...',
    disconnected: 'Déconnecté',
  }[connectionState];

  if (hasLeft) {
    return (
      <div className="login-container">
        <div className="login-form">
          <h2>Chat quitté</h2>
          <p>Vous avez quitté ce salon. Vous pouvez fermer cette fenêtre.</p>
        </div>
      </div>
    );
  }

  if (!hasValidTopic || !authToken) {
    const heading = !hasValidTopic
      ? 'Salon invalide'
      : allowedParentOrigins.length === 0
        ? 'Configuration requise'
        : !parentOrigin
          ? 'Ouvrez le widget depuis l’application hôte'
          : !isAllowedParentOrigin
            ? 'Origine hôte non autorisée'
        : 'En attente de l’application hôte';
    const message = !hasValidTopic
      ? 'Un topicId valide est requis dans l’URL.'
      : allowedParentOrigins.length === 0
        ? 'Configurez VITE_CHAT_PARENT_ORIGINS avec les origines exactes autorisées à intégrer le chat.'
        : !parentOrigin
          ? 'Ouvrez cette page dans une iframe intégrée par l’application hôte.'
          : !isAllowedParentOrigin
            ? `L’origine ${parentOrigin} n’est pas autorisée dans VITE_CHAT_PARENT_ORIGINS.`
          : authError || 'L’application hôte doit transmettre le JWT via postMessage.';

    return (
      <div className="login-container">
        <div className="login-form">
          <h2>{heading}</h2>
          <p>{message}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="login-container">
        <div className="login-form">
          <h2>Chargement du chat...</h2>
        </div>
      </div>
    );
  }

  if (error && !messages.length) {
    return (
      <div className="login-container">
        <div className="login-form">
          <h2>Chat indisponible</h2>
          <p>{error}</p>
          <button type="button" onClick={() => retryHistoryRef.current?.()}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>Salon #{new URLSearchParams(window.location.search).get('topicId')}</h2>
        <div className="connection-status">
          <span
            className={`status status-${connectionState}`}
            role="status"
            aria-live="polite"
          >
            {connectionLabel}
          </span>
          {connectionState === 'disconnected' && (
            <button type="button" onClick={handleReconnect} className="retry-button">
              Réessayer
            </button>
          )}
          <button type="button" onClick={handleLeave} className="leave-button">
            Quitter
          </button>
        </div>
      </div>

      {connectionError && <p className="chat-notice" role="alert">{connectionError}</p>}
      {error && (
        <p className="chat-notice" role="alert">
          {error}
          <button type="button" onClick={() => retryHistoryRef.current?.()}>
            Réessayer l’historique
          </button>
        </p>
      )}
      {deleteError && <p className="chat-notice" role="alert">{deleteError}</p>}

      <div className="chat-body">
        <div className="messages-section">
          <MessageList 
            messages={messages} 
            currentUser={currentUser?.id}
            users={onlineUsers}
            onDeleteMessage={handleDeleteMessage}
            pendingDeleteIds={pendingDeleteIds}
            listRef={messageListRef}
            onScroll={handleMessageListScroll}
            hasMoreHistory={hasMoreHistory}
            isLoadingOlder={isLoadingOlder}
            historyError={historyError}
            onLoadOlder={handleLoadOlder}
          />
        </div>
        
        <div className="users-section">
          <UserList users={onlineUsers} presenceAvailable={hasPresenceData} />
        </div>
      </div>

      <MessageInput 
        onSendMessage={handleSendMessage}
        disabled={!isConnected}
      />
    </div>
  );
};

export default Chat;
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
  const authTokenRef = useRef(null);
  const authPayload = authToken ? decodePayload(authToken) : {};
  const authUserId = Number(authPayload.sub ?? authPayload.userId);

  const [topicInfo, setTopicInfo] = useState(null);
  const [onlineUsersWidth, setOnlineUsersWidth] = useState(280);
  const [sidebarWidthLimit, setSidebarWidthLimit] = useState(480);
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [hasPresenceData, setHasPresenceData] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [connectionError, setConnectionError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [pendingDeleteIds, setPendingDeleteIds] = useState([]);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState(null);
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
  const chatBodyRef = useRef(null);
  const sidebarResizeRef = useRef(null);
  const socketRef = useRef(null);
  const isJoiningRoomRef = useRef(false);
  const hostOriginRef = useRef(null);
  const retryHistoryRef = useRef(null);
  const pendingDeleteTimeoutsRef = useRef(new Map());
  const isLeavingRef = useRef(false);
  const historyCursorRef = useRef(null);
  const loadOlderRef = useRef(null);
  const isLoadingOlderRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const scrollRestoreRef = useRef(null);
  const previousPresenceRef = useRef(null);
  const systemMessageSequenceRef = useRef(0);

  const createSystemMessage = useCallback((text) => {
    const timestamp = new Date().toISOString();
    systemMessageSequenceRef.current += 1;
    return {
      id: (Date.now() * 1000) + systemMessageSequenceRef.current,
      topicId: initialTopicId,
      senderId: null,
      content: text,
      isDeleted: false,
      createdAt: timestamp,
      text,
      userId: null,
      timestamp,
      isSystem: true,
    };
  }, [initialTopicId]);

  useEffect(() => {
    const chatBody = chatBodyRef.current;
    if (!chatBody) return undefined;

    const updateSidebarWidthLimit = () => {
      const maxWidth = Math.min(480, Math.max(180, chatBody.clientWidth - 180));
      setSidebarWidthLimit(maxWidth);
      setOnlineUsersWidth((width) => Math.min(width, maxWidth));
    };

    const observer = new ResizeObserver(updateSidebarWidthLimit);
    observer.observe(chatBody);
    updateSidebarWidthLimit();

    return () => observer.disconnect();
  }, []);

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

    if (!hasValidTopic || window.parent === window || allowedParentOrigins.length === 0) {
      return undefined;
    }

    const handleHostMessage = (event) => {
      if (isTrustedAuthMessage(event, allowedParentOrigins, window.parent)) {
        hostOriginRef.current = event.origin;
        const { token } = event.data;
        if (token === authTokenRef.current) return;
        authTokenRef.current = token;
        setAuthToken(token);
        setAuthError('');
        setIsLoading(true);
        setError('');
        setConnectionState('connecting');
        return;
      }

      const topicInfoMessage = event.data;
      if (
        event.source === window.parent
        && allowedParentOrigins.includes(event.origin)
        && topicInfoMessage?.type === 'SET_TOPIC_INFO'
        && topicInfoMessage.topicId === initialTopicId
        && typeof topicInfoMessage.title === 'string'
        && topicInfoMessage.title.trim().length > 0
        && topicInfoMessage.title.trim().length <= 255
      ) {
        hostOriginRef.current = event.origin;
        setTopicInfo({
          title: topicInfoMessage.title.trim(),
        });
        return;
      }

      const users = getTrustedOnlineUsers(event, allowedParentOrigins, window.parent);
      if (users !== null) {
        hostOriginRef.current = event.origin;
        const previousUsers = previousPresenceRef.current;
        if (previousUsers !== null) {
          const previousById = new Map(previousUsers.map((user) => [user.id, user]));
          const currentById = new Map(users.map((user) => [user.id, user]));
          const systemMessages = [];

          users.forEach((user) => {
            if (!previousById.has(user.id)) {
              systemMessages.push(createSystemMessage(`${user.name} a rejoint le salon.`));
            }
          });
          previousUsers.forEach((user) => {
            if (!currentById.has(user.id)) {
              systemMessages.push(createSystemMessage(`${user.name} a quitté le salon.`));
            }
          });

          if (systemMessages.length > 0) {
            setMessages((previous) => (
              [...previous, ...systemMessages].sort((a, b) => a.id - b.id)
            ));
          }
        }
        previousPresenceRef.current = users;
        setOnlineUsers(users);
        setHasPresenceData(true);
      }
    };

    window.addEventListener('message', handleHostMessage);
    window.parent.postMessage({ type: 'CHAT_READY' }, parentOrigin || '*');

    return () => window.removeEventListener('message', handleHostMessage);
  }, [hasValidTopic, parentOrigin, createSystemMessage, initialTopicId]);

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
      if (!isMounted) return;
      setConnectionState('connecting');
      setConnectionError('');
      isJoiningRoomRef.current = true;
      socket.emit('join_topic', { topicId });
    });
    socket.on('room_joined', ({ topicId: joinedTopicId, history }) => {
      if (!isMounted || !socket.connected || joinedTopicId !== topicId) return;

      isJoiningRoomRef.current = false;
      const joinedMessages = history.map(mapMessageDTO);
      setMessages((previous) => {
        const unique = new Map(previous.map((message) => [message.id, message]));
        joinedMessages.forEach((message) => unique.set(message.id, message));
        return Array.from(unique.values()).sort((a, b) => a.id - b.id);
      });
      setConnectionState('connected');
      setConnectionError('');
      notifyHostPresence('CHAT_JOIN');
    });
    socket.on('error_event', ({ message }) => {
      if (!isMounted || !isJoiningRoomRef.current) return;

      isJoiningRoomRef.current = false;
      setConnectionError(message || 'Impossible de rejoindre le salon.');
      setConnectionState('disconnected');
    });
    socket.on('disconnect', (reason) => {
      if (!isMounted) return;
      isJoiningRoomRef.current = false;
      if (isLeavingRef.current) {
        setConnectionState('disconnected');
      } else {
        setConnectionState(reason === 'io server disconnect' ? 'disconnected' : 'reconnecting');
      }
    });
    socket.on('connect_error', (socketError) => {
      if (isMounted) {
        isJoiningRoomRef.current = false;
        setConnectionState('reconnecting');
        setConnectionError(socketError.message || 'Connexion au chat impossible.');
      }
    });
    const onReconnectAttempt = () => {
      if (isMounted) setConnectionState('reconnecting');
    };
    const onReconnectFailed = () => {
      if (isMounted) {
        isJoiningRoomRef.current = false;
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
    socket.on('message_deleted', ({ topicId: deletedTopicId, messageId }) => {
      if (deletedTopicId !== topicId) return;
      if (isMounted) {
        const timer = pendingDeleteTimeoutsRef.current.get(messageId);
        if (timer !== undefined) window.clearTimeout(timer);
        pendingDeleteTimeoutsRef.current.delete(messageId);
        setPendingDeleteIds((previous) => previous.filter((id) => id !== messageId));
        setMessages((previous) => previous.filter((message) => message.id !== messageId));
        setDeleteError('');
      }
    });

    socket.connect();

    return () => {
      isMounted = false;
      isJoiningRoomRef.current = false;
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

  const getSidebarWidthLimit = () => {
    return sidebarWidthLimit;
  };

  const handleSidebarResizeStart = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: onlineUsersWidth,
    };
  };

  const handleSidebarResize = (event) => {
    const drag = sidebarResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextWidth = drag.startWidth + drag.startX - event.clientX;
    setOnlineUsersWidth(Math.max(180, Math.min(getSidebarWidthLimit(), nextWidth)));
  };

  const handleSidebarResizeEnd = (event) => {
    if (sidebarResizeRef.current?.pointerId === event.pointerId) {
      sidebarResizeRef.current = null;
    }
  };

  const handleSidebarResizeKeyDown = (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? 1 : -1;
      setOnlineUsersWidth((width) => (
        Math.max(180, Math.min(getSidebarWidthLimit(), width + direction * 16))
      ));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setOnlineUsersWidth(180);
    } else if (event.key === 'End') {
      event.preventDefault();
      setOnlineUsersWidth(getSidebarWidthLimit());
    }
  };

  const handleSendMessage = (messageText) => {
    if (!messageText.trim()) return { ok: false, error: 'Le message est vide.' };
    return sendChatMessage(socketRef.current, messageText.trim(), initialTopicId, authUserId);
  };

  const handleDeleteMessage = (messageId) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setDeleteError('Impossible de supprimer le message : vous êtes déconnecté.');
      return;
    }
    if (pendingDeleteTimeoutsRef.current.has(messageId)) return;
    setDeleteConfirmationId(messageId);
  };

  const confirmDeleteMessage = () => {
    const messageId = deleteConfirmationId;
    if (messageId === null) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setDeleteConfirmationId(null);
      setDeleteError('Impossible de supprimer le message : vous êtes déconnecté.');
      return;
    }

    setDeleteConfirmationId(null);
    setDeleteError('');
    setPendingDeleteIds((previous) => [...previous, messageId]);
    const timer = window.setTimeout(() => {
      pendingDeleteTimeoutsRef.current.delete(messageId);
      setPendingDeleteIds((previous) => previous.filter((id) => id !== messageId));
      setDeleteError('La suppression n’a pas été confirmée. Vérifiez la connexion et réessayez.');
    }, 8000);
    pendingDeleteTimeoutsRef.current.set(messageId, timer);
    socket.emit('delete_message', { topicId: initialTopicId, messageId });
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
    const socket = socketRef.current;
    if (!socket || connectionState === 'reconnecting') return;
    setConnectionError('');
    setConnectionState('connecting');
    isJoiningRoomRef.current = true;
    if (socket.connected) {
      socket.emit('join_topic', { topicId: initialTopicId });
    } else {
      socket.connect();
    }
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
        <div className="chat-topic-heading">
          <h2>{topicInfo?.title || 'Nom du salon non communiqué'}</h2>
          <p>Salon #{initialTopicId}</p>
        </div>
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

      <div className="chat-body" ref={chatBodyRef}>
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

        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="Redimensionner la liste des utilisateurs en ligne"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={sidebarWidthLimit}
          aria-valuenow={onlineUsersWidth}
          tabIndex={0}
          onPointerDown={handleSidebarResizeStart}
          onPointerMove={handleSidebarResize}
          onPointerUp={handleSidebarResizeEnd}
          onPointerCancel={handleSidebarResizeEnd}
          onKeyDown={handleSidebarResizeKeyDown}
        />

        <div
          className="users-section"
          style={{ '--users-section-width': `${onlineUsersWidth}px` }}
        >
          <UserList users={onlineUsers} presenceAvailable={hasPresenceData} />
        </div>
      </div>

      <MessageInput 
        onSendMessage={handleSendMessage}
        disabled={!isConnected}
      />

      {deleteConfirmationId !== null && (
        <div className="delete-confirmation-overlay" role="presentation">
          <div
            className="delete-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirmation-title"
            aria-describedby="delete-confirmation-description"
          >
            <h3 id="delete-confirmation-title">Supprimer le message ?</h3>
            <p id="delete-confirmation-description">
              Cette action est irréversible.
            </p>
            <div className="delete-confirmation-actions">
              <button
                type="button"
                className="delete-confirmation-cancel"
                onClick={() => setDeleteConfirmationId(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="delete-confirmation-confirm"
                onClick={confirmDeleteMessage}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
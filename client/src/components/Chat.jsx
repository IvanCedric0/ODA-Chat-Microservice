import React, { useState, useEffect, useRef } from 'react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import UserList from './UserList';
import { createChatSocket } from '../lib/socket';
import './Chat.css';

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
  const initialParams = new URLSearchParams(window.location.search);
  const initialTopicId = Number(initialParams.get('topicId'));
  const initialToken = initialParams.get('token');
  const missingConfig = !Number.isInteger(initialTopicId) || initialTopicId <= 0 || !initialToken;
  const initialPayload = initialToken ? decodePayload(initialToken) : {};
  const initialUserId = initialPayload.userId ?? Number(initialPayload.sub);
  const initialCurrentUser = Number.isInteger(initialUserId)
    ? { id: initialUserId, name: `Utilisateur ${initialUserId}` }
    : null;

  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState(initialCurrentUser ? [initialCurrentUser] : []);
  const [currentUser] = useState(initialCurrentUser);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(!missingConfig);
  const [error, setError] = useState(
    missingConfig ? 'Paramètres manquants : topicId et token sont requis.' : ''
  );

  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (missingConfig) return undefined;

    const topicId = initialTopicId;
    const token = initialToken;

    let isMounted = true;

    const payload = decodePayload(token);
    const userId = payload.userId ?? Number(payload.sub);

    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/v1/topics/${topicId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Impossible de charger l’historique (${response.status}).`);
        }
        const history = await response.json();
        if (!isMounted) return;

        setMessages(history.map((message) => ({
          id: message.id,
          text: message.content,
          userId: message.sender_id,
          timestamp: message.created_at,
        })));
        const senderIds = Array.from(new Set(history.map((message) => message.sender_id)));
        if (Number.isInteger(userId) && !senderIds.includes(userId)) {
          senderIds.unshift(userId);
        }
        setUsers(senderIds.map((id) => ({
          id,
          name: `Utilisateur ${id}`,
        })));
      } catch (loadError) {
        if (isMounted) setError(loadError.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadHistory();

    const socket = createChatSocket(token, topicId);
    socketRef.current = socket;

    socket.on('connect', () => {
      if (isMounted) setIsConnected(true);
    });
    socket.on('disconnect', () => {
      if (isMounted) setIsConnected(false);
    });
    socket.on('connect_error', (socketError) => {
      if (isMounted) setError(socketError.message || 'Connexion au chat impossible.');
    });
    socket.on('new_message', (message) => {
      if (!isMounted) return;
      setMessages((previous) => {
        if (previous.some((item) => item.id === message.id)) return previous;
        return [...previous, {
          id: message.id,
          text: message.content,
          userId: message.sender_id,
          timestamp: message.created_at,
        }];
      });
      setUsers((previous) => previous.some((user) => user.id === message.sender_id)
        ? previous
        : [...previous, { id: message.sender_id, name: `Utilisateur ${message.sender_id}` }]);
    });
    socket.on('message_deleted', ({ message_id }) => {
      if (isMounted) {
        setMessages((previous) => previous.filter((message) => message.id !== message_id));
      }
    });

    socket.connect();

    return () => {
      isMounted = false;
      socket.off();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [initialToken, initialTopicId, missingConfig]);

  const handleSendMessage = (messageText) => {
    if (!messageText.trim()) return { ok: false, error: 'Le message est vide.' };
    if (!socketRef.current?.connected) return { ok: false, error: 'Vous êtes déconnecté.' };

    return new Promise((resolve) => {
      socketRef.current.emit(
        'send_message',
        { content: messageText.trim() },
        (response) => resolve(response),
      );
    });
  };

  const handleDeleteMessage = (messageId) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('delete_message', { message_id: messageId });
    }
  };

  const handleLeave = () => {
    socketRef.current?.disconnect();
    setIsConnected(false);
  };

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
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>Salon #{new URLSearchParams(window.location.search).get('topicId')}</h2>
        <div className="connection-status">
          <span className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connecté' : 'Déconnecté'}
          </span>
          <button onClick={handleLeave} className="leave-button">
            Quitter
          </button>
        </div>
      </div>

      <div className="chat-body">
        <div className="messages-section">
          <MessageList 
            messages={messages} 
            currentUser={currentUser?.id}
            onDeleteMessage={handleDeleteMessage}
          />
          <div ref={messagesEndRef} />
        </div>
        
        <div className="users-section">
          <UserList users={users} />
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
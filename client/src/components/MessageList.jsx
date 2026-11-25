import React, { useState } from 'react';

const MessageList = ({
  messages,
  currentUser,
  users,
  onDeleteMessage,
  pendingDeleteIds,
  listRef,
  onScroll,
  hasMoreHistory,
  isLoadingOlder,
  historyError,
  onLoadOlder,
}) => {
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div
      className="message-list"
      ref={listRef}
      onScroll={onScroll}
      role="region"
      aria-label="Messages du salon"
      tabIndex={0}
    >
      {hasMoreHistory && (
        <div className="history-controls">
          <button type="button" onClick={onLoadOlder} disabled={isLoadingOlder}>
            {isLoadingOlder ? 'Chargement...' : 'Charger les messages précédents'}
          </button>
        </div>
      )}
      {historyError && (
        <div className="history-error" role="alert">
          <span>{historyError}</span>
          <button type="button" onClick={onLoadOlder} disabled={isLoadingOlder}>
            Réessayer
          </button>
        </div>
      )}
      {messages.length === 0 && (
        <p className="history-empty" role="status">Aucun message pour le moment.</p>
      )}
      <div role="log" aria-live="polite" aria-relevant="additions removals" aria-atomic="false">
        {messages.map((message) => {
          const date = new Date(message.timestamp);
          const isDeleting = pendingDeleteIds.includes(message.id);

          return (
            <div
              key={message.id}
              className={`message ${
                message.isSystem
                  ? 'system-message'
                  : message.userId === currentUser
                    ? 'own-message'
                    : 'other-message'
              }`}
            >
              {!message.isSystem && (
                <div className="message-header">
                  <span className="message-user">
                    {userNames.get(message.userId) || `Utilisateur ${message.userId}`}
                  </span>
                  <span className="message-time">
                    <time dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}>
                      {formatTime(message.timestamp)}
                    </time>
                  </span>
                </div>
              )}
              <div className="message-text">{message.text}</div>
              {!message.isSystem && message.userId === currentUser && (
                isDeleting ? (
                  <button
                    type="button"
                    className="delete-message-button"
                    disabled
                    aria-label="Suppression en cours"
                  >
                    Suppression...
                  </button>
                ) : confirmDeleteId === message.id ? (
                  <div
                    className="delete-confirmation"
                    role="group"
                    aria-label="Confirmation de suppression du message"
                  >
                    <span>Supprimer ce message ?</span>
                    <button
                      type="button"
                      className="confirm-delete-button"
                      onClick={() => {
                        setConfirmDeleteId(null);
                        onDeleteMessage(message.id);
                      }}
                    >
                      Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      aria-label="Annuler la suppression"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="delete-message-button"
                    onClick={() => setConfirmDeleteId(message.id)}
                    aria-label="Supprimer ce message"
                  >
                    Supprimer
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MessageList;
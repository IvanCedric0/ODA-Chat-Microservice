import React from 'react';

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

  // Format timestamp for display
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
                <button
                  type="button"
                  className="delete-message-button"
                  onClick={() => onDeleteMessage(message.id)}
                  disabled={isDeleting}
                  aria-label={isDeleting ? 'Suppression en cours' : 'Supprimer ce message'}
                >
                  {isDeleting ? 'Suppression...' : 'Supprimer'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MessageList;
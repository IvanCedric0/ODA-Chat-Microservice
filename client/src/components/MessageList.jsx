import React from 'react';

const MessageList = ({ messages, currentUser, onDeleteMessage }) => {
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
    <div className="message-list">
      {messages.map((message) => (
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
                {message.isSystem ? 'System' : `Utilisateur ${message.userId}`}
              </span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
          )}
          <div className="message-text">
            {message.text}
          </div>
          {!message.isSystem && message.userId === currentUser && (
            <button
              type="button"
              className="delete-message-button"
              onClick={() => onDeleteMessage(message.id)}
              aria-label="Supprimer ce message"
            >
              Supprimer
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default MessageList;
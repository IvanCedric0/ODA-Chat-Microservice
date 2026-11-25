import React, { useState } from 'react';

const MessageInput = ({ onSendMessage, disabled }) => {
  const [message, setMessage] = useState('');
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim() || isSending) return;

    setIsSending(true);
    setSendError('');
    const result = await onSendMessage(message);
    if (result?.ok) {
      setMessage('');
    } else {
      setSendError(result?.error || "L'envoi du message a échoué.");
    }
    setIsSending(false);
  };

  return (
    <form onSubmit={handleSubmit} className="message-input-form">
      <div className="input-container">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={disabled ? "Connexion..." : "Saisissez votre message..."}
          disabled={disabled || isSending}
          maxLength={500}
        />
        <button 
          type="submit" 
          disabled={disabled || isSending || !message.trim()}
          className="send-button"
        >
          {isSending ? 'Envoi...' : 'Envoyer'}
        </button>
      </div>
      {sendError && <p className="send-error" role="alert">{sendError}</p>}
    </form>
  );
};

export default MessageInput;
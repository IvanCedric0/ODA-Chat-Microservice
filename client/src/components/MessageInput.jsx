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
    try {
      const result = await onSendMessage(message);
      if (result?.ok) {
        setMessage('');
      } else {
        setSendError(result?.error || "L'envoi du message a échoué.");
      }
    } catch {
      setSendError("L'envoi du message a échoué. Vérifiez votre connexion et réessayez.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="message-input-form" aria-busy={isSending}>
      <div className="input-container">
        <input
          type="text"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (sendError) setSendError('');
          }}
          placeholder={disabled ? "Connexion..." : "Saisissez votre message..."}
          disabled={disabled || isSending}
          maxLength={500}
          aria-label="Votre message"
          aria-describedby={sendError ? 'send-error' : undefined}
          enterKeyHint="send"
        />
        <button 
          type="submit" 
          disabled={disabled || isSending || !message.trim()}
          className="send-button"
          aria-label={isSending ? 'Envoi du message' : 'Envoyer le message'}
        >
          {isSending ? 'Envoi...' : 'Envoyer'}
        </button>
      </div>
      {sendError && <p id="send-error" className="send-error" role="alert">{sendError}</p>}
    </form>
  );
};

export default MessageInput;
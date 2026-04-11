import React, { useEffect, useRef } from 'react';

export interface ChatMessage {
  id: string;
  sender: 'claude' | 'human' | 'system';
  type: 'text' | 'action' | 'question' | 'annotation' | 'system' | 'info' | 'suggestion';
  content: string;
  timestamp: string | Date;
  elements_affected?: string[];
}

interface Props {
  messages: ChatMessage[];
  onFocusElements?: (ids: string[]) => void;
}

function formatTime(ts: string | Date): string {
  try {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function ChatThread({ messages, onFocusElements }: Props): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="chat-thread">
        <div className="chat-empty">
          Nessun messaggio. Disegna sul canvas e premi<br />
          "👀 Claude, guarda!" quando vuoi un feedback.
        </div>
      </div>
    );
  }

  return (
    <div className="chat-thread">
      {messages.map((msg) => (
        <div key={msg.id} className={`chat-message ${msg.sender} ${msg.type}`}>
          {msg.sender === 'claude' && <div className="message-avatar">C</div>}
          <div className="message-content">
            {msg.type === 'action' && <span className="action-badge">🎨 Azione</span>}
            {msg.type === 'question' && <span className="action-badge">❓ Domanda</span>}
            {msg.type === 'suggestion' && <span className="action-badge">💡 Suggerimento</span>}
            <p>{msg.content}</p>
            {msg.elements_affected && msg.elements_affected.length > 0 && (
              <button
                className="focus-elements-btn"
                onClick={() => onFocusElements?.(msg.elements_affected!)}
              >
                📍 Mostra sul canvas
              </button>
            )}
          </div>
          <time className="message-time">{formatTime(msg.timestamp)}</time>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

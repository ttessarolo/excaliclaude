import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
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
          No messages yet. Draw on the canvas, then press<br />
          "👀 Claude, look!" when you want feedback.
        </div>
      </div>
    );
  }

  return (
    <div className="chat-thread">
      {messages.map((msg) => (
        <div key={msg.id} className={`chat-message ${msg.sender} ${msg.type}`}>
          <div className="message-content">
            {msg.type === 'action' && <span className="action-badge">🎨 Action</span>}
            {msg.type === 'question' && <span className="action-badge">❓ Question</span>}
            {msg.type === 'suggestion' && <span className="action-badge">💡 Suggestion</span>}
            {msg.sender === 'system' ? (
              <p>{msg.content}</p>
            ) : (
              <div className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ node, ...props }) => (
                      <a {...props} target="_blank" rel="noreferrer noopener" />
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
            {msg.elements_affected && msg.elements_affected.length > 0 && (
              <button
                className="focus-elements-btn"
                onClick={() => onFocusElements?.(msg.elements_affected!)}
              >
                📍 Show on canvas
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

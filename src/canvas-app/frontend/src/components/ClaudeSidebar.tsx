import React from 'react';
import { ChatThread, ChatMessage } from './ChatThread';
import { ChatInput } from './ChatInput';

export interface SessionInfo {
  id: string;
  title: string;
  status: 'starting' | 'ready' | 'closed';
}

interface Props {
  session: SessionInfo;
  connected: boolean;
  messages: ChatMessage[];
  onSendSignal: (
    type: 'look' | 'message' | 'approve',
    message?: string,
  ) => void;
  onClose: () => void;
  onFocusElements?: (ids: string[]) => void;
}

export function ClaudeSidebar({
  session,
  connected,
  messages,
  onSendSignal,
  onClose,
  onFocusElements,
}: Props): JSX.Element {
  return (
    <aside className="claude-sidebar" aria-label="Claude sidebar">
      <header className="claude-sidebar-header">
        <div className="session-info">
          <h3>{session.title}</h3>
          <span className="session-status">
            {connected ? '🟢 Connesso' : '🔴 Disconnesso'}
            {' · '}
            {session.status}
          </span>
        </div>
        <button onClick={onClose} className="close-btn" aria-label="Chiudi sidebar">
          ×
        </button>
      </header>

      <ChatThread messages={messages} onFocusElements={onFocusElements} />

      <footer className="claude-sidebar-footer">
        <ChatInput
          onSend={(text) => onSendSignal('message', text)}
          disabled={!connected}
          placeholder="Scrivi a Claude..."
        />
        <div className="signal-buttons">
          <button
            className="signal-btn primary"
            onClick={() => onSendSignal('look')}
            disabled={!connected}
            title="Chiedi a Claude di guardare lo stato del canvas"
          >
            👀 Claude, guarda!
          </button>
          <button
            className="signal-btn secondary"
            onClick={() => onSendSignal('approve')}
            disabled={!connected}
            title="Approva l'ultima modifica di Claude"
          >
            ✅ Approva
          </button>
        </div>
      </footer>
    </aside>
  );
}

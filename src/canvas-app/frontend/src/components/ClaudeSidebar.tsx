import React from 'react';
import { ChatThread, ChatMessage } from './ChatThread';
import { ChatInput } from './ChatInput';

export interface SessionInfo {
  id: string;
  title: string;
  status: 'starting' | 'ready' | 'closed';
}

export interface ClaudeStatusInfo {
  busy: boolean;
  tool: string | null;
  label: string | null;
  history: string[];
}

interface Props {
  session: SessionInfo;
  connected: boolean;
  messages: ChatMessage[];
  claudeStatus?: ClaudeStatusInfo;
  collapsed?: boolean;
  onSendSignal: (type: 'look' | 'message', message?: string) => void;
  onQuit: () => void;
  onFocusElements?: (ids: string[]) => void;
}

export function ClaudeSidebar({
  session,
  connected,
  messages,
  claudeStatus,
  collapsed,
  onSendSignal,
  onQuit,
  onFocusElements,
}: Props): JSX.Element {
  const busy = !!claudeStatus?.busy;
  const currentLabel = claudeStatus?.label || 'Thinking...';
  const history = claudeStatus?.history || [];
  // Show the trailing history minus the current label if it matches the tail,
  // so the active label isn't duplicated as a trail entry.
  const trail =
    history.length > 0 && history[history.length - 1] === currentLabel
      ? history.slice(0, -1)
      : history;

  return (
    <aside
      className={`claude-sidebar${collapsed ? ' collapsed' : ''}`}
      aria-label="Claude sidebar"
      aria-hidden={collapsed}
    >
      <header className="claude-sidebar-header">
        <div className="session-info">
          <h3>{session.title}</h3>
          <span className="session-status">
            {connected ? '🟢 Connected' : '🔴 Disconnected'}
            {' · '}
            {session.status}
          </span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={onQuit}
            className="icon-btn"
            aria-label="Quit session"
            title="Quit session"
          >
            ×
          </button>
        </div>
      </header>

      <ChatThread messages={messages} onFocusElements={onFocusElements} />

      <footer className="claude-sidebar-footer">
        {busy && (
          <div
            className="claude-thinking"
            role="status"
            aria-live="polite"
            title={claudeStatus?.tool || 'Claude is working'}
          >
            <div className="claude-thinking-head">
              <span className="claude-thinking-spinner" aria-hidden="true" />
              <span className="claude-thinking-label">{currentLabel}</span>
            </div>
            {trail.length > 0 && (
              <ul className="claude-thinking-trail">
                {trail.map((entry, i) => (
                  <li key={`${entry}-${i}`}>{entry}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ChatInput
          onSend={(text) => onSendSignal('message', text)}
          disabled={!connected}
          busy={busy}
          placeholder="Message Claude..."
        />
        <div className="signal-buttons">
          <button
            className="signal-btn primary"
            onClick={() => onSendSignal('look')}
            disabled={!connected}
            title="Ask Claude to look at the canvas"
          >
            👀 Claude, look!
          </button>
        </div>
      </footer>
    </aside>
  );
}

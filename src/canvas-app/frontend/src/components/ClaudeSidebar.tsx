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
}

interface Props {
  session: SessionInfo;
  connected: boolean;
  messages: ChatMessage[];
  claudeStatus?: ClaudeStatusInfo;
  collapsed?: boolean;
  onSendSignal: (
    type: 'look' | 'message' | 'approve',
    message?: string,
  ) => void;
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
  const statusLabel = claudeStatus?.label || 'Thinking...';
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
          {busy && (
            <div
              className="claude-thinking"
              role="status"
              aria-live="polite"
              title={claudeStatus?.tool || 'Claude is working'}
            >
              <span className="claude-thinking-spinner" aria-hidden="true" />
              <span className="claude-thinking-label">{statusLabel}</span>
            </div>
          )}
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
        <ChatInput
          onSend={(text) => onSendSignal('message', text)}
          disabled={!connected}
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
          <button
            className="signal-btn secondary"
            onClick={() => onSendSignal('approve')}
            disabled={!connected}
            title="Approve Claude's last change"
          >
            ✅ Approve
          </button>
        </div>
      </footer>
    </aside>
  );
}

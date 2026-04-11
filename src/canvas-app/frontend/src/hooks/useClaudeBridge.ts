// ExcaliClaude — React hook per il bridge Claude ↔ Canvas
//
// Gestisce in un unico posto:
//  • stato messaggi Claude (thread della sidebar)
//  • stato sessione (id, title, status)
//  • invio segnali umani ("Claude, guarda!", text message)
//  • ricezione di `claude_message` via WebSocket
//  • caricamento iniziale dello storico messaggi da /api/claude/messages
//
// Il hook accetta la WebSocket già esistente (riutilizziamo quella di App.tsx)
// per non aprire connessioni duplicate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../components/ChatThread';
import type { SessionInfo } from '../components/ClaudeSidebar';

export interface ClaudeStatus {
  busy: boolean;
  tool: string | null;
  label: string | null;
  /** Trailing log of recent activity labels for the current turn. */
  history: string[];
}

export interface SignalExtras {
  sceneUnchangedSinceLastTurn?: boolean;
  sessionMemory?: string;
}

export interface ClaudeBridge {
  session: SessionInfo;
  messages: ChatMessage[];
  hasUnread: boolean;
  claudeStatus: ClaudeStatus;
  markAllRead: () => void;
  sendSignal: (
    type: 'look' | 'message',
    message?: string,
    extras?: SignalExtras,
  ) => Promise<void>;
  handleWsMessage: (data: any) => void;
}

const HISTORY_MAX = 6;

export function useClaudeBridge(connected: boolean): ClaudeBridge {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus>({
    busy: false,
    tool: null,
    label: null,
    history: [],
  });
  // Avoid pushing duplicate labels back-to-back when the server debounces.
  const lastHistoryLabelRef = useRef<string | null>(null);

  const session = useMemo<SessionInfo>(() => {
    const globalAny = window as any;
    return {
      id: globalAny.__EXCALICLAUDE_SESSION_ID__ || 'default',
      title: globalAny.__EXCALICLAUDE_SESSION_TITLE__ || 'ExcaliClaude',
      status: connected ? 'ready' : 'starting',
    };
  }, [connected]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/claude/messages')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) setMessages(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Called by App.tsx from the shared WebSocket onmessage handler */
  const handleWsMessage = useCallback((data: any) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'claude_message' && data.message) {
      setMessages((prev) => [...prev, data.message]);
      setHasUnread(true);
    } else if (data.type === 'claude_status') {
      const busy = !!data.busy;
      const label: string | null = data.label ?? null;
      setClaudeStatus((prev) => {
        if (!busy) {
          lastHistoryLabelRef.current = null;
          return { busy: false, tool: null, label: null, history: [] };
        }
        let history = prev.history;
        if (label && label !== lastHistoryLabelRef.current) {
          lastHistoryLabelRef.current = label;
          history = [...prev.history, label].slice(-HISTORY_MAX);
        }
        return {
          busy: true,
          tool: data.tool ?? null,
          label,
          history,
        };
      });
    }
  }, []);

  const markAllRead = useCallback(() => setHasUnread(false), []);

  const sendSignal = useCallback(
    async (
      type: 'look' | 'message',
      message?: string,
      extras?: SignalExtras,
    ): Promise<void> => {
      if (type === 'message' && message) {
        const localMsg: ChatMessage = {
          id: `local-${Date.now()}`,
          sender: 'human',
          type: 'text',
          content: message,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, localMsg]);
      } else if (type === 'look') {
        const localMsg: ChatMessage = {
          id: `local-${Date.now()}`,
          sender: 'system',
          type: 'system',
          content: '👀 Requested Claude feedback',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, localMsg]);
      }

      // Optimistic thinking indicator — server will refine via WS.
      lastHistoryLabelRef.current = 'Thinking...';
      setClaudeStatus({
        busy: true,
        tool: null,
        label: 'Thinking...',
        history: ['Thinking...'],
      });

      try {
        await fetch('/api/claude/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signal_type: type,
            message,
            timestamp: new Date().toISOString(),
            sceneUnchangedSinceLastTurn: extras?.sceneUnchangedSinceLastTurn,
            sessionMemory: extras?.sessionMemory,
          }),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ExcaliClaude] signal failed', err);
      }
    },
    [],
  );

  return {
    session,
    messages,
    hasUnread,
    claudeStatus,
    markAllRead,
    sendSignal,
    handleWsMessage,
  };
}

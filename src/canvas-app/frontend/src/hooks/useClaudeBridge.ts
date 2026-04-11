// ExcaliClaude — React hook per il bridge Claude ↔ Canvas
//
// Gestisce in un unico posto:
//  • stato messaggi Claude (thread della sidebar)
//  • stato sessione (id, title, status)
//  • invio segnali umani ("Claude, guarda!", approve, text message)
//  • ricezione di `claude_message` via WebSocket
//  • caricamento iniziale dello storico messaggi da /api/claude/messages
//
// Il hook accetta la WebSocket già esistente (riutilizziamo quella di App.tsx)
// per non aprire connessioni duplicate.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '../components/ChatThread';
import type { SessionInfo } from '../components/ClaudeSidebar';

export interface ClaudeBridge {
  session: SessionInfo;
  messages: ChatMessage[];
  hasUnread: boolean;
  markAllRead: () => void;
  sendSignal: (type: 'look' | 'message' | 'approve', message?: string) => Promise<void>;
  handleWsMessage: (data: any) => void;
}

export function useClaudeBridge(connected: boolean): ClaudeBridge {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasUnread, setHasUnread] = useState(false);

  // Session info is injected by the canvas server via env at boot time.
  // The frontend reads it from a well-known meta tag / global (fallback to
  // generic "ExcaliClaude Session" if absent).
  const session = useMemo<SessionInfo>(() => {
    const globalAny = window as any;
    return {
      id: globalAny.__EXCALICLAUDE_SESSION_ID__ || 'default',
      title: globalAny.__EXCALICLAUDE_SESSION_TITLE__ || 'ExcaliClaude',
      status: connected ? 'ready' : 'starting',
    };
  }, [connected]);

  // Load message history on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/claude/messages')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) setMessages(data);
      })
      .catch(() => {
        // silent: history endpoint optional
      });
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
    }
  }, []);

  const markAllRead = useCallback(() => setHasUnread(false), []);

  const sendSignal = useCallback(
    async (
      type: 'look' | 'message' | 'approve',
      message?: string,
    ): Promise<void> => {
      // Optimistic: add the human message to the thread
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
          content: '👀 Richiesto feedback a Claude',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, localMsg]);
      } else if (type === 'approve') {
        const localMsg: ChatMessage = {
          id: `local-${Date.now()}`,
          sender: 'system',
          type: 'system',
          content: '✅ Approvato',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, localMsg]);
      }

      try {
        await fetch('/api/claude/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signal_type: type,
            message,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (err) {
        // Errors are visible via status indicator; no need to crash
        // the UI.
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
    markAllRead,
    sendSignal,
    handleWsMessage,
  };
}

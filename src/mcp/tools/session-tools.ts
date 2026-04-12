// ExcaliClaude — Session Tools
//
// Definisce gli 8 tool di sessione che trasformano mcp_excalidraw in una
// piattaforma di collaborazione bidirezionale umano ↔ Claude:
//
//   1. open_canvas            — Apre un nuovo canvas (o carica un file .excalidraw)
//   2. close_canvas           — Chiude una sessione, opzionalmente la salva
//   3. list_sessions          — Elenca le sessioni attive
//   4. wait_for_human         — Long-poll bloccante: aspetta il segnale umano
//   5. save_session           — Salva lo stato corrente come .excalidraw
//   6. send_message_to_canvas — Invia un messaggio Claude alla sidebar
//   7. annotate               — Crea un'annotazione (testo + freccia) sul canvas
//   8. get_human_changes      — Recupera le modifiche umane recenti
//
// I tool sono registrati come oggetti "schema" che vengono mergiati con quelli
// legacy di mcp_excalidraw in src/mcp/index.ts, e come handler centralizzato
// `registerSessionToolsLegacy` che il dispatcher invoca nel default case del
// switch.

import fs from 'fs';
import path from 'path';
import { sessionManager } from '../session-manager.js';
import logger from '../utils/logger.js';

export const SESSION_TOOL_DEFINITIONS: Array<{
  name: string;
  description: string;
  inputSchema: any;
}> = [
  {
    name: 'open_canvas',
    description:
      'Apre un nuovo canvas Excalidraw in una finestra nativa dedicata. Usa questo tool per iniziare una sessione di collaborazione visiva con l\'umano.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Titolo della sessione canvas' },
        blank: { type: 'boolean', description: 'true per canvas vuoto (default)', default: true },
        load_from: { type: 'string', description: 'Path a un file .excalidraw da caricare' },
        save_path: { type: 'string', description: 'Path dove salvare la sessione alla chiusura' },
      },
    },
  },
  {
    name: 'close_canvas',
    description: 'Chiude una sessione canvas attiva. Opzionalmente salva lo stato.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'ID sessione (default: attiva)' },
        save: { type: 'boolean', description: 'Salva prima di chiudere', default: true },
      },
    },
  },
  {
    name: 'list_sessions',
    description: 'Lista tutte le sessioni canvas attive con il loro stato.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wait_for_human',
    description:
      'Tool BLOCCANTE: invia un messaggio opzionale alla sidebar del canvas, poi aspetta che l\'umano segnali "Claude, guarda!". Ritorna lo stato del canvas e un eventuale messaggio. Usare dopo ogni intervento di Claude.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        timeout_ms: { type: 'number', description: 'Timeout in millisecondi', default: 300000 },
        message: { type: 'string', description: 'Messaggio da mostrare nella sidebar prima di attendere (opzionale)' },
        message_type: {
          type: 'string',
          enum: ['info', 'question', 'suggestion', 'action'],
          default: 'info',
          description: 'Tipo del messaggio (opzionale)',
        },
      },
    },
  },
  {
    name: 'save_session',
    description: 'Salva lo stato corrente del canvas come file .excalidraw.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        session_id: { type: 'string' },
        path: { type: 'string', description: 'Path del file .excalidraw da scrivere' },
        include_png: { type: 'boolean', description: 'Salva anche un PNG accanto', default: false },
      },
    },
  },
  {
    name: 'send_message_to_canvas',
    description:
      'Invia un messaggio testuale di Claude visibile nella sidebar del canvas. Usare per comunicare con l\'umano durante la sessione.',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        session_id: { type: 'string' },
        message: { type: 'string', description: 'Testo del messaggio' },
        type: {
          type: 'string',
          enum: ['info', 'question', 'suggestion', 'action'],
          default: 'info',
        },
      },
    },
  },
  {
    name: 'annotate',
    description:
      'Crea un\'annotazione Claude (testo + freccia tratteggiata) collegata a un elemento del canvas. Usa per commentare il lavoro dell\'umano senza sovrascriverlo.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        session_id: { type: 'string' },
        target_element_id: {
          type: 'string',
          description: 'ID elemento a cui agganciare l\'annotazione',
        },
        text: { type: 'string' },
        position: {
          type: 'string',
          enum: ['top', 'right', 'bottom', 'left', 'auto'],
          default: 'auto',
        },
        style: {
          type: 'string',
          enum: ['note', 'comment', 'highlight', 'question'],
          default: 'comment',
        },
      },
    },
  },
  {
    name: 'get_human_changes',
    description:
      'Restituisce gli elementi modificati dall\'umano (non da Claude) dall\'ultimo check.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        since: { type: 'string', description: 'Timestamp ISO da cui cercare modifiche' },
      },
    },
  },
];

type ToolResult = {
  content: Array<{ type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

/** Resolve session URL, returning a structured ToolResult error if the
 *  session is closed. Use in tools that issue HTTP requests to the canvas
 *  so that a closed session fails fast with a clear message instead of
 *  hitting a dead port and surfacing an opaque "fetch failed". */
function resolveBaseUrlOrError(
  sessionId: string | undefined,
): { url: string; error?: undefined } | { url?: undefined; error: ToolResult } {
  try {
    return { url: sessionManager.getSessionUrl(sessionId) };
  } catch (err) {
    return {
      error: {
        content: [{ type: 'text', text: (err as Error).message }],
        isError: true,
      },
    };
  }
}

/**
 * Dispatcher per i tool ExcaliClaude. Ritorna `null` se il tool non appartiene
 * alla suite session-tools (così il chiamante può proseguire la risoluzione o
 * lanciare "unknown tool").
 */
export async function registerSessionToolsLegacy(
  name: string,
  args: any,
): Promise<ToolResult | null> {
  const a = args || {};
  switch (name) {
    case 'open_canvas': {
      const session = await sessionManager.createSession({
        title: a.title,
        blank: a.blank !== false,
        loadFrom: a.load_from,
        savePath: a.save_path,
      });
      return {
        content: [
          {
            type: 'text',
            text:
              `Canvas "${session.title}" aperto su http://localhost:${session.port}\n` +
              `Session ID: ${session.id}\n` +
              `Status: ${session.status}`,
          },
        ],
      };
    }

    case 'close_canvas': {
      await sessionManager.closeSession(a.session_id, a.save !== false);
      return { content: [{ type: 'text', text: 'Sessione chiusa.' }] };
    }

    case 'list_sessions': {
      const sessions = sessionManager.listSessions();
      const text =
        sessions
          .map(
            (s) =>
              `[${s.id}] "${s.title}" — port ${s.port} — ${s.elements} elementi — ${s.status}`,
          )
          .join('\n') || 'Nessuna sessione attiva.';
      return { content: [{ type: 'text', text }] };
    }

    case 'wait_for_human': {
      const timeoutMs = a.timeout_ms ?? 300_000;
      const resolved = resolveBaseUrlOrError(a.session_id);
      if (resolved.error) return resolved.error;
      const baseUrl = resolved.url;
      try {
        // Send optional message to sidebar before waiting
        if (a.message) {
          await fetch(`${baseUrl}/api/claude/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: a.message,
              type: a.message_type || 'info',
              timestamp: new Date().toISOString(),
            }),
          }).catch(() => {}); // best-effort, don't block wait
        }
        const res = await fetch(`${baseUrl}/api/claude/wait-for-signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeout_ms: timeoutMs }),
          signal: AbortSignal.timeout(timeoutMs + 5000),
        });
        const result: any = await res.json();
        const content: ToolResult['content'] = [];
        if (result.signal_type === 'window_closed' || result.signal_type === 'shutdown') {
          return {
            content: [
              {
                type: 'text',
                text:
                  'La finestra del canvas è stata chiusa. La sessione è ' +
                  'terminata. Usa `open_canvas` per riaprire un nuovo canvas ' +
                  'quando vuoi continuare.',
              },
            ],
          };
        }
        if (result.signal_type === 'timeout') {
          content.push({ type: 'text', text: 'Timeout: l\'umano non ha segnalato.' });
        } else {
          if (result.message) {
            content.push({ type: 'text', text: `Messaggio dall'umano: ${result.message}` });
          }
          if (result.canvas_summary) {
            content.push({ type: 'text', text: `Stato canvas:\n${result.canvas_summary}` });
          }
          if (result.sceneUnchangedSinceLastTurn) {
            content.push({
              type: 'text',
              text:
                '[Scene diff hint] La scena non è cambiata dall\'ultimo turn: ' +
                'riusa la descrizione/screenshot precedente e NON richiamare ' +
                'describe_scene o get_canvas_screenshot per risparmiare token, ' +
                'a meno che non sia strettamente necessario.',
            });
          }
          if (result.sessionMemory) {
            content.push({
              type: 'text',
              text:
                '[Session memory from previous save]\n' +
                String(result.sessionMemory) +
                '\n[/Session memory]',
            });
          }
          if (result.screenshot_base64) {
            content.push({
              type: 'image',
              data: result.screenshot_base64,
              mimeType: 'image/png',
            });
          }
        }
        return { content };
      } catch (err) {
        const msg = (err as Error).message || '';
        const isConnErr = /fetch failed|ECONNREFUSED|ECONNRESET|network|connect/i.test(msg);
        const text = isConnErr
          ? 'Il canvas non risponde (connessione interrotta). ' +
            'La finestra è stata chiusa o il processo canvas è morto. ' +
            'Usa `open_canvas` per riaprire e riprendere la sessione.'
          : `Errore wait_for_human: ${msg}`;
        return {
          content: [{ type: 'text', text }],
          isError: true,
        };
      }
    }

    case 'save_session': {
      if (!a.path) {
        return { content: [{ type: 'text', text: 'Parametro path richiesto' }], isError: true };
      }
      const resolvedSave = resolveBaseUrlOrError(a.session_id);
      if (resolvedSave.error) return resolvedSave.error;
      const baseUrl = resolvedSave.url;
      try {
        const sceneRes = await fetch(`${baseUrl}/api/export/scene`);
        if (!sceneRes.ok) {
          throw new Error(`HTTP ${sceneRes.status}`);
        }
        const scene = await sceneRes.json();
        const absPath = path.resolve(a.path);
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        await fs.promises.writeFile(absPath, JSON.stringify(scene, null, 2));
        logger.info(`Session saved to ${absPath}`);
        return {
          content: [{ type: 'text', text: `Canvas salvato in ${absPath}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Errore save_session: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }

    case 'send_message_to_canvas': {
      const resolvedMsg = resolveBaseUrlOrError(a.session_id);
      if (resolvedMsg.error) return resolvedMsg.error;
      const baseUrl = resolvedMsg.url;
      try {
        await fetch(`${baseUrl}/api/claude/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: a.message,
            type: a.type || 'info',
            timestamp: new Date().toISOString(),
          }),
        });
        return { content: [{ type: 'text', text: 'Messaggio inviato al canvas.' }] };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Errore send_message_to_canvas: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }

    case 'annotate': {
      const resolvedAnn = resolveBaseUrlOrError(a.session_id);
      if (resolvedAnn.error) return resolvedAnn.error;
      const baseUrl = resolvedAnn.url;
      try {
        const res = await fetch(`${baseUrl}/api/claude/annotate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_element_id: a.target_element_id,
            text: a.text,
            position: a.position || 'auto',
            style: a.style || 'comment',
          }),
        });
        const result: any = await res.json();
        return {
          content: [
            {
              type: 'text',
              text: `Annotazione creata (${result.elements_created ?? 0} elementi).`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Errore annotate: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }

    case 'get_human_changes': {
      const resolvedHc = resolveBaseUrlOrError(a.session_id);
      if (resolvedHc.error) return resolvedHc.error;
      const baseUrl = resolvedHc.url;
      const qs = a.since ? `?since=${encodeURIComponent(a.since)}` : '';
      try {
        const res = await fetch(`${baseUrl}/api/claude/human-changes${qs}`);
        const changes: any = await res.json();
        return {
          content: [
            {
              type: 'text',
              text: changes.summary || 'Nessuna modifica dall\'ultimo check.',
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Errore get_human_changes: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }

    default:
      return null;
  }
}

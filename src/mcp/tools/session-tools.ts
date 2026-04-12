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

/** MCP extra context passed by the SDK request handler (optional). */
type McpExtra = {
  sendNotification?: (notification: any) => Promise<void>;
  [key: string]: any;
};

/**
 * Send a progress notification to keep the MCP connection alive during
 * long-running waits. Best-effort: silently ignored if the client didn't
 * provide a progressToken or if sending fails.
 */
async function sendProgressKeepalive(
  extra: McpExtra | undefined,
  progressToken: string | number | undefined,
  tick: number,
): Promise<void> {
  if (!extra?.sendNotification || progressToken == null) return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: tick,
        message: 'In attesa del segnale umano sul canvas...',
      },
    });
  } catch {
    // best-effort — non bloccare il loop
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
  extra?: McpExtra,
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
      // Keepalive polling: instead of a single long HTTP request that
      // Claude Desktop would kill after ~4 minutes, we poll in short
      // intervals and send MCP progress notifications between each
      // iteration so the client knows we're still alive.
      const POLL_INTERVAL_MS = 55_000; // well under Claude Desktop's ~4min timeout
      const resolved = resolveBaseUrlOrError(a.session_id);
      if (resolved.error) return resolved.error;
      const baseUrl = resolved.url;

      // Extract progressToken from the MCP request metadata (if the client
      // sent one). We use it to send keepalive progress notifications.
      const progressToken: string | number | undefined =
        (extra as any)?._meta?.progressToken ??
        (extra as any)?.requestInfo?._meta?.progressToken;

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

        let tick = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const res = await fetch(`${baseUrl}/api/claude/wait-for-signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeout_ms: POLL_INTERVAL_MS }),
            signal: AbortSignal.timeout(POLL_INTERVAL_MS + 5000),
          });
          const result: any = await res.json();

          // ── Terminal signals — return immediately ──
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

          // ── Timeout from canvas server — no signal yet, loop again ──
          if (result.signal_type === 'timeout') {
            tick++;
            logger.info(`[wait_for_human] keepalive tick ${tick} — still waiting`);
            await sendProgressKeepalive(extra, progressToken, tick);
            continue;
          }

          // ── Real signal received — build response ──
          const content: ToolResult['content'] = [];
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
          return { content };
        }
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

        // Build folder: <parent>/<slug>-<YYYYMMDD>/
        const rawPath = path.resolve(a.path);
        const baseName = path.basename(rawPath, '.excalidraw') || 'canvas';
        const parentDir = path.dirname(rawPath);
        const now = new Date();
        const shortDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const folderName = `${baseName}-${shortDate}`;
        const outDir = path.join(parentDir, folderName);
        await fs.promises.mkdir(outDir, { recursive: true });

        const excalidrawPath = path.join(outDir, `${baseName}.excalidraw`);
        await fs.promises.writeFile(excalidrawPath, JSON.stringify(scene, null, 2));
        logger.info(`Session saved to ${excalidrawPath}`);

        // Companion session memory (.md)
        const memoryPath = path.join(outDir, 'memory.md');
        try {
          const memRes = await fetch(`${baseUrl}/api/claude/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: baseName }),
          });
          const memResult: any = await memRes.json();
          // The /api/claude/save endpoint writes its own files, but we need the
          // memory markdown content. Fetch it from the session-memory endpoint.
          // Instead, just read the messages and build memory ourselves.
          const msgsRes = await fetch(`${baseUrl}/api/claude/messages`);
          if (msgsRes.ok) {
            const msgs: any[] = await msgsRes.json();
            const significant = msgs.filter((m: any) =>
              m.type === 'text' || m.type === 'question' || m.type === 'annotation' || m.type === 'suggestion',
            );
            const lines: string[] = [
              `# Session: ${baseName}`,
              `Saved: ${now.toISOString()}`,
              '',
              '## Conversation',
            ];
            if (significant.length === 0) {
              lines.push('_(no significant dialogue)_');
            } else {
              for (const m of significant) {
                const who = m.sender === 'human' ? 'You' : 'Claude';
                const tag = m.type && m.type !== 'text' ? ` _(${m.type})_` : '';
                let body = (m.content || '').replace(/\s+$/g, '');
                if (body.length > 500) body = body.slice(0, 500) + '…';
                lines.push(`**${who}${tag}:** ${body}`);
              }
            }
            lines.push('');
            await fs.promises.writeFile(memoryPath, lines.join('\n'));
            logger.info(`Session memory saved to ${memoryPath}`);
          }
        } catch (memErr) {
          logger.warn(`Session memory write failed: ${(memErr as Error).message}`);
        }

        return {
          content: [{ type: 'text', text: `Canvas salvato in ${outDir}/\n  → ${baseName}.excalidraw\n  → memory.md` }],
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

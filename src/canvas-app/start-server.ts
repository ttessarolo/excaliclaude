#!/usr/bin/env node
// ExcaliClaude — Canvas Server Entry Point
//
// Avvia il server Express + WebSocket del canvas per una singola sessione.
// Spawnato dal SessionManager (src/mcp/session-manager.ts) con env vars
// PORT, SESSION_ID, SESSION_TITLE. La finestra nativa è gestita da un
// processo separato (open-window.ts).
//
// Il modulo ./server.ts esegue `server.listen(PORT, HOST)` come side-effect
// al momento dell'import, quindi basta settare le env vars e importarlo
// dinamicamente (così il parse di `process.env.PORT` avviene prima).

const port = parseInt(process.env.PORT || '3100', 10);
const sessionId = process.env.SESSION_ID || 'default';
const title = process.env.SESSION_TITLE || 'ExcaliClaude';

// Ensure the server module sees the correct port
process.env.PORT = String(port);
process.env.HOST = process.env.HOST || 'localhost';
process.env.EXCALICLAUDE_SESSION_ID = sessionId;
process.env.EXCALICLAUDE_SESSION_TITLE = title;

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
  await import('./server.js');
  // Log once the module loads — the HTTP server is now listening
  console.error(`[canvas:${port}] Session ${sessionId} ("${title}") listening`);
})();

const shutdown = (signal: string) => {
  console.error(`[canvas:${port}] Received ${signal}, exiting`);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

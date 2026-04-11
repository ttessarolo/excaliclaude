#!/usr/bin/env bun
// ExcaliClaude — Native Window Process
//
// Processo standalone che apre una finestra OS nativa con webview-bun
// (WebKit su macOS/Linux, WebView2/Edge su Windows). Il SessionManager
// spawna questo script dopo aver verificato che il canvas server sia
// raggiungibile, passando l'URL via --url.
//
// Se webview-bun non è disponibile (es. dipendenze native mancanti su
// Linux, o Bun non installato), il processo fallisce subito e il
// SessionManager cade sul fallback Chrome app-mode.

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const url = parseArg('--url') || process.env.WINDOW_URL;
  const title = parseArg('--title') || 'ExcaliClaude';
  const width = parseInt(parseArg('--width') || '1280', 10);
  const height = parseInt(parseArg('--height') || '800', 10);
  const sessionId = parseArg('--session-id') || 'default';

  if (!url) {
    console.error('[open-window] Missing --url argument');
    process.exit(2);
  }

  // Dynamic import so a missing webview-bun doesn't crash at module load
  let Webview: any;
  try {
    ({ Webview } = await import('webview-bun' as any));
  } catch (err) {
    console.error(`[open-window] webview-bun not available: ${err}`);
    process.exit(3);
  }

  const webview = new Webview();
  webview.title = title;

  // hint: 0 = none (resizable), 1 = min, 2 = max, 3 = fixed
  if (typeof webview.size === 'object') {
    webview.size = { width, height, hint: 0 };
  }

  // Escape hatches that the frontend can invoke via window.excaliclaude_*
  if (typeof webview.bind === 'function') {
    webview.bind('excaliclaude_close', () => {
      try {
        webview.destroy();
      } catch {}
      process.exit(0);
    });
    webview.bind('excaliclaude_setTitle', (newTitle: string) => {
      webview.title = newTitle;
    });
  }

  console.error(`[open-window] Session ${sessionId} opening ${url}`);
  webview.navigate(url);
  webview.run();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[open-window] Fatal: ${err}`);
  process.exit(1);
});

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

import { execFileSync } from 'child_process';

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function getMacMainScreenSize(): { width: number; height: number } | null {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync(
      '/usr/bin/osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        'ObjC.import("AppKit"); var f = $.NSScreen.mainScreen.frame; JSON.stringify({w: f.size.width, h: f.size.height})',
      ],
      { encoding: 'utf8', timeout: 1500 },
    );
    const parsed = JSON.parse(out.trim());
    const w = Math.round(Number(parsed.w));
    const h = Math.round(Number(parsed.h));
    if (w > 0 && h > 0) return { width: w, height: h };
  } catch {}
  return null;
}

function defaultSize(): { width: number; height: number } {
  const screen = getMacMainScreenSize();
  if (!screen) return { width: 1280, height: 800 };
  return {
    width: Math.round(screen.width * 0.85),
    height: Math.round(screen.height * 0.85),
  };
}

async function main(): Promise<void> {
  const url = parseArg('--url') || process.env.WINDOW_URL;
  const title = parseArg('--title') || 'ExcaliClaude';
  const fallback = defaultSize();
  const width = parseInt(parseArg('--width') || String(fallback.width), 10);
  const height = parseInt(parseArg('--height') || String(fallback.height), 10);
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

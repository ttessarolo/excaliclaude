#!/usr/bin/env bun
// ExcaliClaude — Standalone Canvas Binary (bun build --compile entry).
// Compone server-core + frontend embedded + webview-bun.
//
// Modalità:
//   (default)        server Express + spawn di se stesso con --webview-only
//   --webview-only   apre solo la finestra webview-bun (event loop bloccante)
//   --headless       server only, nessuna finestra (smoke tests)
//
// Il self-spawn è necessario perché webview.run() blocca l'event loop nel
// processo che lo invoca: tenere server HTTP e webview nello stesso processo
// fa sì che il server non risponda più alle richieste del webview.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createCanvasApp } from './server-core.js';
import { getEmbeddedFile } from './embedded-frontend.js';
import type { Request, Response, NextFunction } from 'express';

function parseArg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const PORT = parseInt(process.env.PORT || parseArg('--port', '3100'), 10);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_ID = process.env.SESSION_ID || parseArg('--session-id', 'default');
const SESSION_TITLE = process.env.SESSION_TITLE || parseArg('--title', 'ExcaliClaude');
const WINDOW_WIDTH = parseInt(process.env.WINDOW_WIDTH || parseArg('--width', '1280'), 10);
const WINDOW_HEIGHT = parseInt(process.env.WINDOW_HEIGHT || parseArg('--height', '800'), 10);
const HEADLESS = process.env.HEADLESS === '1' || process.argv.includes('--headless');
const WEBVIEW_ONLY = process.argv.includes('--webview-only');
const WEBVIEW_URL = parseArg('--url', `http://${HOST}:${PORT}`);

// ---- Debug logger (file-based so parent + child + MCP can tail the same log)
const LOG_PATH =
  process.env.CANVAS_BIN_LOG ||
  path.join(os.tmpdir(), 'excaliclaude-canvas-bin.log');

function dlog(tag: string, msg: string): void {
  const line = `${new Date().toISOString()} [${process.pid}] [${tag}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
  // Also mirror to stderr so the MCP SessionManager can capture it via proc.stderr.
  try {
    process.stderr.write(`[canvas-bin:${tag}] ${msg}\n`);
  } catch {}
}

function guessMime(p: string): string {
  const ext = p.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    wasm: 'application/wasm',
    map: 'application/json; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

async function serveEmbedded(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const blob = getEmbeddedFile(req.path);
  if (!blob) {
    dlog('http', `MISS ${req.method} ${req.path}`);
    return next();
  }
  const mime = (blob as any).type || guessMime(req.path);
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  try {
    const buf = Buffer.from(await blob.arrayBuffer());
    res.status(200).send(buf);
    dlog('http', `HIT ${req.method} ${req.path} (${buf.length}B ${mime})`);
  } catch (err) {
    dlog('http', `ERR ${req.method} ${req.path}: ${err}`);
    next(err);
  }
}

async function runWebviewOnly(): Promise<void> {
  dlog('webview', `pid=${process.pid} url=${WEBVIEW_URL} title="${SESSION_TITLE}"`);
  let Webview: any;
  try {
    ({ Webview } = await import('webview-bun'));
    dlog('webview', 'webview-bun module loaded');
  } catch (err) {
    dlog('webview', `FATAL: webview-bun import failed: ${err}`);
    process.exit(2);
  }
  let webview: any;
  try {
    webview = new Webview();
    dlog('webview', 'Webview instance created');
  } catch (err) {
    dlog('webview', `FATAL: Webview() ctor failed: ${err}`);
    process.exit(3);
  }
  try {
    webview.title = `ExcaliClaude — ${SESSION_TITLE}`;
  } catch (err) {
    dlog('webview', `title set failed: ${err}`);
  }
  try {
    if (typeof webview.size === 'object' || 'size' in webview) {
      webview.size = { width: WINDOW_WIDTH, height: WINDOW_HEIGHT, hint: 0 };
      dlog('webview', `size set ${WINDOW_WIDTH}x${WINDOW_HEIGHT}`);
    }
  } catch (err) {
    dlog('webview', `size set failed: ${err}`);
  }
  try {
    webview.navigate(WEBVIEW_URL);
    dlog('webview', `navigate() called → ${WEBVIEW_URL}`);
  } catch (err) {
    dlog('webview', `FATAL: navigate failed: ${err}`);
    process.exit(4);
  }
  dlog('webview', 'calling run() — blocking event loop until window closes');
  try {
    webview.run();
  } catch (err) {
    dlog('webview', `run() threw: ${err}`);
    process.exit(5);
  }
  dlog('webview', 'run() returned — window closed');
  process.exit(0);
}

async function runServer(): Promise<void> {
  dlog('server', `starting pid=${process.pid} port=${PORT} host=${HOST} session=${SESSION_ID}`);
  dlog('server', `argv: ${JSON.stringify(process.argv)}`);
  dlog('server', `execPath: ${process.execPath}`);
  dlog('server', `log file: ${LOG_PATH}`);

  const { server } = createCanvasApp({
    sessionId: SESSION_ID,
    title: SESSION_TITLE,
    rootHandler: (req, res, next) => void serveEmbedded(req, res, next),
    staticHandler: (req, res, next) => void serveEmbedded(req, res, next),
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err) => {
      dlog('server', `listen error: ${err}`);
      reject(err);
    });
    server.listen(PORT, HOST, () => {
      dlog('server', `listening on http://${HOST}:${PORT}`);
      resolve();
    });
  });
  console.error(`[canvas-bin] Session ${SESSION_ID} listening on http://${HOST}:${PORT}`);

  if (HEADLESS) {
    dlog('server', 'HEADLESS mode — no window, keeping process alive');
    console.error(`[canvas-bin] HEADLESS mode — window disabled`);
    await new Promise(() => {});
    return;
  }

  const selfPath = process.execPath;
  dlog('server', `spawning webview child: ${selfPath} --webview-only --url http://${HOST}:${PORT}`);
  const child = spawn(
    selfPath,
    [
      '--webview-only',
      '--url',
      `http://${HOST}:${PORT}`,
      '--title',
      SESSION_TITLE,
      '--width',
      String(WINDOW_WIDTH),
      '--height',
      String(WINDOW_HEIGHT),
    ],
    {
      env: {
        ...process.env,
        CANVAS_BIN_LOG: LOG_PATH,
        // Clear server-only vars so the child doesn't re-bind the port.
        PORT: '',
        HOST: '',
        HEADLESS: '',
        SESSION_ID: SESSION_ID,
        SESSION_TITLE,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (d) => dlog('child:out', String(d).trimEnd()));
  child.stderr?.on('data', (d) => dlog('child:err', String(d).trimEnd()));

  child.on('spawn', () => dlog('server', `child spawned pid=${child.pid}`));
  child.on('error', (err) => dlog('server', `child spawn error: ${err}`));

  const exitCode: number = await new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => {
      dlog('server', `child exited code=${code} signal=${signal}`);
      resolve(code ?? 0);
    });
  });

  dlog('server', `webview child done (code=${exitCode}), shutting down HTTP server`);
  console.error(`[canvas-bin] Window closed, shutting down`);
  server.close();
  process.exit(exitCode);
}

async function main(): Promise<void> {
  dlog('main', `mode=${WEBVIEW_ONLY ? 'webview-only' : HEADLESS ? 'headless' : 'server'}`);
  if (WEBVIEW_ONLY) return runWebviewOnly();
  return runServer();
}

main().catch((err) => {
  dlog('main', `FATAL: ${err?.stack || err}`);
  console.error(`[canvas-bin] Fatal: ${err}`);
  process.exit(1);
});

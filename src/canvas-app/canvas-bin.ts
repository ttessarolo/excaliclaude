#!/usr/bin/env bun
// ExcaliClaude — Standalone Canvas Binary (bun build --compile entry).
// Compone server-core + frontend embedded + webview-bun in un unico processo.

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
  if (!blob) return next();
  const mime = (blob as any).type || guessMime(req.path);
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const buf = Buffer.from(await blob.arrayBuffer());
  res.status(200).send(buf);
}

async function main(): Promise<void> {
  const { app, server } = createCanvasApp({
    sessionId: SESSION_ID,
    title: SESSION_TITLE,
    rootHandler: (req, res, next) => void serveEmbedded(req, res, next),
    staticHandler: (req, res, next) => void serveEmbedded(req, res, next),
  });

  await new Promise<void>((resolve) => server.listen(PORT, HOST, () => resolve()));
  console.error(`[canvas-bin] Session ${SESSION_ID} listening on http://${HOST}:${PORT}`);

  let Webview: any;
  try {
    ({ Webview } = await import('webview-bun'));
  } catch (err) {
    console.error(`[canvas-bin] webview-bun unavailable: ${err}`);
    console.error(`[canvas-bin] Server running headless on http://${HOST}:${PORT}`);
    await new Promise(() => {});
    return;
  }

  const webview = new Webview();
  try {
    webview.title = `ExcaliClaude — ${SESSION_TITLE}`;
  } catch {}
  try {
    if (typeof webview.size === 'object') {
      webview.size = { width: WINDOW_WIDTH, height: WINDOW_HEIGHT, hint: 0 };
    }
  } catch {}
  webview.navigate(`http://${HOST}:${PORT}`);
  webview.run();

  console.error(`[canvas-bin] Window closed, shutting down`);
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[canvas-bin] Fatal: ${err}`);
  process.exit(1);
});

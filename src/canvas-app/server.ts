// server.ts — Dev entry (tsx watch). Thin wrapper around createCanvasApp.
// In production, il binary compilato (canvas-bin.ts) crea la propria istanza.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createCanvasApp } from './server-core.js';
import logger from '../mcp/utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '../..');
}

const PROJECT_ROOT = findProjectRoot();
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'dist', 'frontend');
const FONTS_DIR = path.join(
  PROJECT_ROOT,
  'node_modules',
  '@excalidraw',
  'excalidraw',
  'dist',
  'prod',
  'fonts',
);

const LIBRARIES_DIR = path.join(PROJECT_ROOT, 'libraries');

const { server } = createCanvasApp({
  sessionId: process.env.EXCALICLAUDE_SESSION_ID,
  title: process.env.EXCALICLAUDE_SESSION_TITLE,
  serveStaticFrom: FRONTEND_DIR,
  fontsDir: FONTS_DIR,
  librariesDir: LIBRARIES_DIR,
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, HOST, () => {
  logger.info(`Canvas dev server running on http://${HOST}:${PORT}`);
  logger.info(`WebSocket server running on ws://${HOST}:${PORT}`);
});

export default server;

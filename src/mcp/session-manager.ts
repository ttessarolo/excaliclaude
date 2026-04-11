// ExcaliClaude — SessionManager
// Gestisce il ciclo di vita delle sessioni canvas: spawn processi Bun/Node
// per il canvas server + apertura finestra nativa tramite webview-bun,
// con fallback automatico a Chrome app-mode e browser di default.

import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CanvasSession {
  id: string;
  title: string;
  port: number;
  serverProcess: ChildProcess | null;
  windowProcess: ChildProcess | null;
  status: 'starting' | 'ready' | 'closed';
  createdAt: Date;
  lastActivity: Date;
  savePath?: string;
  elements: number;
}

export interface CreateSessionOptions {
  title: string;
  blank?: boolean;
  loadFrom?: string;
  savePath?: string;
}

export class SessionManager {
  private sessions: Map<string, CanvasSession> = new Map();
  private nextPort: number = 3100;
  private activeSessionId: string | null = null;
  private fallbackUrl: string =
    process.env.EXPRESS_SERVER_URL || 'http://localhost:3000';

  /** Ritorna il runtime preferito (bun se disponibile, altrimenti node) */
  private getRuntime(): string {
    try {
      execSync('bun --version', { stdio: 'ignore' });
      return 'bun';
    } catch {
      return 'node';
    }
  }

  /** Attende che il canvas server risponda su una porta */
  private async waitForReady(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const url = `http://localhost:${port}/api/elements`;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url);
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Canvas server on port ${port} not ready after ${timeoutMs}ms`);
  }

  /** Crea una nuova sessione canvas: spawna server + finestra */
  async createSession(options: CreateSessionOptions): Promise<CanvasSession> {
    const id = (webcrypto as any).randomUUID();
    const port = this.nextPort++;
    const url = `http://localhost:${port}`;
    const runtime = this.getRuntime();

    // Candidate locations of the canvas server entry point.
    // In dev we spawn the TypeScript source; in production (dist) we spawn the compiled JS.
    const candidates = [
      path.resolve(__dirname, '../canvas-app/start-server.ts'),
      path.resolve(__dirname, '../canvas-app/start-server.js'),
      path.resolve(__dirname, '../../src/canvas-app/start-server.ts'),
      path.resolve(__dirname, '../../dist/canvas-app/start-server.js'),
    ];
    const startScript = candidates.find((p) => fs.existsSync(p)) || candidates[0];

    logger.info(`[SessionManager] Spawning canvas server for session ${id} on port ${port}`);

    const serverProcess = spawn(runtime, [startScript], {
      env: {
        ...process.env,
        PORT: String(port),
        SESSION_ID: id,
        SESSION_TITLE: options.title,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    serverProcess.stdout?.on('data', (d) => logger.debug(`[canvas:${port}] ${d}`));
    serverProcess.stderr?.on('data', (d) => logger.debug(`[canvas:${port}:err] ${d}`));
    serverProcess.on('exit', (code) => {
      logger.info(`[SessionManager] Canvas server for ${id} exited with code ${code}`);
      const s = this.sessions.get(id);
      if (s) s.status = 'closed';
    });

    const session: CanvasSession = {
      id,
      title: options.title,
      port,
      serverProcess,
      windowProcess: null,
      status: 'starting',
      createdAt: new Date(),
      lastActivity: new Date(),
      savePath: options.savePath,
      elements: 0,
    };
    this.sessions.set(id, session);
    this.activeSessionId = id;

    try {
      await this.waitForReady(port, 15_000);
    } catch (err) {
      logger.error(`[SessionManager] Canvas server failed to become ready: ${err}`);
      serverProcess.kill();
      this.sessions.delete(id);
      throw err;
    }

    // Load existing excalidraw file if requested
    if (options.loadFrom) {
      try {
        const content = await fs.promises.readFile(options.loadFrom, 'utf-8');
        const scene = JSON.parse(content);
        await fetch(`${url}/api/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scene),
        });
      } catch (err) {
        logger.warn(`[SessionManager] Could not load ${options.loadFrom}: ${err}`);
      }
    }

    // Open the native window (with fallback chain)
    session.windowProcess = await this.openWindow(url, options.title, id);
    session.status = 'ready';
    return session;
  }

  /** 3-livelli di fallback per aprire una finestra: webview-bun → Chrome app-mode → default browser */
  private async openWindow(
    url: string,
    title: string,
    sessionId: string,
  ): Promise<ChildProcess | null> {
    const runtime = this.getRuntime();

    // Level 1: webview-bun
    const openWindowScript = [
      path.resolve(__dirname, '../canvas-app/open-window.ts'),
      path.resolve(__dirname, '../canvas-app/open-window.js'),
      path.resolve(__dirname, '../../src/canvas-app/open-window.ts'),
      path.resolve(__dirname, '../../dist/canvas-app/open-window.js'),
    ].find((p) => fs.existsSync(p));

    if (runtime === 'bun' && openWindowScript) {
      try {
        const proc = spawn(
          runtime,
          [
            openWindowScript,
            '--url', url,
            '--title', `ExcaliClaude — ${title}`,
            '--width', '1280',
            '--height', '800',
            '--session-id', sessionId,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        // Wait briefly to see if it errors out (webview-bun missing native deps)
        const ok = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(true), 1500);
          proc.on('error', () => {
            clearTimeout(t);
            resolve(false);
          });
          proc.on('exit', (code) => {
            clearTimeout(t);
            // An early exit is usually a failure (e.g. missing webview-bun module)
            resolve(code === 0);
          });
        });
        if (ok) {
          logger.info(`[SessionManager] Window opened via webview-bun for ${sessionId}`);
          return proc;
        }
      } catch (err) {
        logger.warn(`[SessionManager] webview-bun failed: ${err}`);
      }
    }

    // Level 2: Chrome / Edge / Brave / Chromium in --app mode
    for (const chromePath of this.findChromePaths()) {
      try {
        if (chromePath.includes('/') && !fs.existsSync(chromePath)) continue;
        const proc = spawn(
          chromePath,
          [
            `--app=${url}`,
            `--window-size=1280,800`,
            `--window-name=ExcaliClaude — ${title}`,
            '--disable-extensions',
            '--disable-default-apps',
          ],
          { stdio: 'ignore', detached: true },
        );
        proc.unref();
        logger.info(`[SessionManager] Window opened via Chrome app-mode (${chromePath}) for ${sessionId}`);
        return proc;
      } catch {
        continue;
      }
    }

    // Level 3: default browser
    try {
      const open = await import('open');
      await open.default(url);
      logger.info(`[SessionManager] Window opened via default browser for ${sessionId}`);
    } catch (err) {
      logger.warn(`[SessionManager] No window backend available (${err}). Canvas URL: ${url}`);
    }
    return null;
  }

  private findChromePaths(): string[] {
    const platform = process.platform;
    if (platform === 'darwin') {
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ];
    }
    if (platform === 'win32') {
      return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ];
    }
    return ['google-chrome', 'chromium-browser', 'chromium', 'microsoft-edge', 'brave-browser'];
  }

  /** Chiude una sessione, opzionalmente salvando lo stato */
  async closeSession(sessionId?: string, save: boolean = true): Promise<void> {
    const id = sessionId || this.activeSessionId;
    if (!id) return;
    const session = this.sessions.get(id);
    if (!session) return;

    if (save && session.savePath) {
      try {
        const res = await fetch(`http://localhost:${session.port}/api/export/scene`);
        if (res.ok) {
          const scene = await res.json();
          await fs.promises.writeFile(session.savePath, JSON.stringify(scene, null, 2));
        }
      } catch (err) {
        logger.warn(`[SessionManager] Could not save session to ${session.savePath}: ${err}`);
      }
    }

    session.windowProcess?.kill();
    session.serverProcess?.kill();
    session.status = 'closed';
    this.sessions.delete(id);
    if (this.activeSessionId === id) {
      const remaining = Array.from(this.sessions.keys());
      this.activeSessionId = remaining[remaining.length - 1] || null;
    }
  }

  /** Risolve l'URL base per una sessione specifica o quella attiva */
  getSessionUrl(sessionId?: string): string {
    const id = sessionId || this.activeSessionId;
    if (id) {
      const s = this.sessions.get(id);
      if (s) return `http://localhost:${s.port}`;
    }
    return this.fallbackUrl;
  }

  /** URL attivo (per interpolazione template-string legacy) */
  getActiveUrl(): string {
    return this.getSessionUrl();
  }

  listSessions(): CanvasSession[] {
    return Array.from(this.sessions.values());
  }

  setActiveSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) this.activeSessionId = sessionId;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  async pingSession(sessionId: string): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    try {
      const res = await fetch(`http://localhost:${s.port}/api/elements`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async cleanup(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) {
      await this.closeSession(id, false);
    }
  }
}

/** Singleton globale — usato sia dal MCP server sia dai wrapper session-aware. */
export const sessionManager = new SessionManager();

/**
 * Shim compatibile con string: permette di usarlo dentro template literals legacy
 * (`${EXPRESS_SERVER_URL}/api/...`) mantenendo il comportamento session-aware.
 * Chiamare `.toString()` risolve l'URL della sessione attiva.
 */
export const EXPRESS_SERVER_URL_PROXY: any = {
  toString() {
    return sessionManager.getActiveUrl();
  },
  [Symbol.toPrimitive]() {
    return sessionManager.getActiveUrl();
  },
};

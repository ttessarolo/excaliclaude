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

  /** Risale l'albero da __dirname finché trova package.json (la project root). */
  private findProjectRoot(): string {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return path.resolve(__dirname, '../..');
  }

  /**
   * Assicura che il frontend sia buildato. Se `dist/frontend/index.html` manca,
   * esegue `npm run build:frontend` al volo (prima esecuzione post-install).
   * Throw con istruzioni chiare se il build fallisce.
   */
  private ensureFrontendBuilt(): void {
    const projectRoot = this.findProjectRoot();
    const indexPath = path.join(projectRoot, 'dist', 'frontend', 'index.html');
    if (fs.existsSync(indexPath)) return;

    logger.info(
      `[SessionManager] Frontend non trovato in ${indexPath} — eseguo build:frontend (prima esecuzione, ~20-40s)...`,
    );
    try {
      execSync('npm run build:frontend', {
        cwd: projectRoot,
        stdio: 'pipe',
        env: { ...process.env, CI: '1' },
      });
    } catch (err) {
      const stderr = (err as any)?.stderr?.toString?.() || '';
      throw new Error(
        `Build del frontend ExcaliClaude fallito. Esegui manualmente \`npm install && npm run build\` in ${projectRoot}.\n${stderr}`,
      );
    }
    if (!fs.existsSync(indexPath)) {
      throw new Error(
        `Build del frontend completato ma ${indexPath} non esiste. Controlla la configurazione vite.`,
      );
    }
    logger.info(`[SessionManager] Frontend buildato con successo.`);
  }

  /**
   * Cerca il binary `canvas-<platform>-<arch>` compilato in dist/bin/.
   * Ritorna il path assoluto o null se non trovato.
   */
  private findCanvasBinary(): string | null {
    const projectRoot = this.findProjectRoot();
    const p = process.platform;
    const a = process.arch;
    const binDir = path.join(projectRoot, 'dist', 'bin');

    const map: Record<string, string> = {
      'darwin-arm64': 'canvas-darwin-arm64',
      'darwin-x64': 'canvas-darwin-x64',
      'linux-arm64': 'canvas-linux-arm64',
      'linux-x64': 'canvas-linux-x64',
      'win32-x64': 'canvas-windows-x64.exe',
    };
    const name = map[`${p}-${a}`];
    if (!name) return null;

    // On macOS, prefer the `.app` bundle (so LaunchServices attaches the
    // proper dock icon). Fall back to the raw binary if the bundle is absent.
    if (p === 'darwin') {
      const suffix = `${p}-${a}`;
      const bundled = path.join(
        binDir,
        `ExcaliClaude-${suffix}.app`,
        'Contents',
        'MacOS',
        'excaliclaude',
      );
      if (fs.existsSync(bundled)) return bundled;
    }

    const raw = path.join(binDir, name);
    return fs.existsSync(raw) ? raw : null;
  }

  /**
   * Spawna il binary standalone (unico processo: server + window).
   * Ritorna il ChildProcess o null se il binary non esiste.
   */
  private spawnCanvasBinary(
    port: number,
    sessionId: string,
    title: string,
  ): ChildProcess | null {
    const binary = this.findCanvasBinary();
    if (!binary) return null;

    logger.info(`[SessionManager] Spawning canvas binary ${binary} for session ${sessionId}`);

    const proc = spawn(binary, [], {
      env: {
        ...process.env,
        PORT: String(port),
        SESSION_ID: sessionId,
        SESSION_TITLE: title,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d) => logger.debug(`[canvas-bin:${port}] ${d}`));
    proc.stderr?.on('data', (d) => logger.debug(`[canvas-bin:${port}:err] ${d}`));
    proc.on('exit', (code) => {
      logger.info(`[SessionManager] Canvas binary for ${sessionId} exited with code ${code}`);
      const s = this.sessions.get(sessionId);
      if (s) s.status = 'closed';
    });

    return proc;
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

  /** Crea una nuova sessione canvas: spawna binary (o fallback legacy 2-process) */
  async createSession(options: CreateSessionOptions): Promise<CanvasSession> {
    const id = (webcrypto as any).randomUUID();
    const port = this.nextPort++;
    const url = `http://localhost:${port}`;

    // Prefer standalone binary (single process: server + window)
    const binaryProcess = this.spawnCanvasBinary(port, id, options.title);

    let serverProcess: ChildProcess | null = binaryProcess;
    let windowProcess: ChildProcess | null = binaryProcess;

    if (!binaryProcess) {
      logger.warn(
        `[SessionManager] No canvas binary found for ${process.platform}-${process.arch}. ` +
          `Falling back to legacy dev mode (requires build:frontend).`,
      );
      this.ensureFrontendBuilt();

      const runtime = this.getRuntime();
      const candidates = [
        path.resolve(__dirname, '../canvas-app/start-server.ts'),
        path.resolve(__dirname, '../canvas-app/start-server.js'),
        path.resolve(__dirname, '../../src/canvas-app/start-server.ts'),
        path.resolve(__dirname, '../../dist/canvas-app/start-server.js'),
      ];
      const startScript = candidates.find((p) => fs.existsSync(p)) || candidates[0];

      logger.info(`[SessionManager] Spawning legacy canvas server for ${id} on port ${port}`);

      serverProcess = spawn(runtime, [startScript], {
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
      windowProcess = null;
    }

    const session: CanvasSession = {
      id,
      title: options.title,
      port,
      serverProcess,
      windowProcess,
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
      logger.error(`[SessionManager] Canvas did not become ready: ${err}`);
      serverProcess?.kill();
      this.sessions.delete(id);
      throw err;
    }

    if (options.loadFrom) {
      try {
        const content = await fs.promises.readFile(options.loadFrom, 'utf-8');
        const scene = JSON.parse(content);
        await fetch(`${url}/api/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scene),
        });

        // Arm session memory from companion .md if present.
        // Check both sibling .md (legacy) and memory.md in same folder (new format).
        const loadDir = path.dirname(options.loadFrom);
        const siblingMd = options.loadFrom.replace(/\.excalidraw$/, '.md');
        const folderMd = path.join(loadDir, 'memory.md');
        const mdPath = fs.existsSync(folderMd) ? folderMd
          : fs.existsSync(siblingMd) ? siblingMd
          : null;
        if (mdPath) {
          const memory = await fs.promises.readFile(mdPath, 'utf-8');
          await fetch(`${url}/api/claude/session-memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memory }),
          }).catch(() => {});
          logger.info(`[SessionManager] Armed session memory from ${mdPath} (${memory.length} chars)`);
        }
      } catch (err) {
        logger.warn(`[SessionManager] Could not load ${options.loadFrom}: ${err}`);
      }
    }

    // Only open a separate window if we're in legacy fallback mode
    if (!binaryProcess) {
      session.windowProcess = await this.openWindow(url, options.title, id);
    }

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

  /** Risolve l'URL base per una sessione specifica o quella attiva.
   *  Lancia un errore se la sessione è stata chiusa (status='closed') in
   *  modo che i tool MCP possano ritornare un messaggio strutturato invece
   *  di andare in fetch contro un server morto (→ "fetch failed" opaco). */
  getSessionUrl(sessionId?: string): string {
    const id = sessionId || this.activeSessionId;
    if (id) {
      const s = this.sessions.get(id);
      if (s) {
        if (s.status === 'closed') {
          throw new Error(
            `Canvas session "${s.title}" è stata chiusa. ` +
              'Usa `open_canvas` per riaprirla.',
          );
        }
        return `http://localhost:${s.port}`;
      }
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

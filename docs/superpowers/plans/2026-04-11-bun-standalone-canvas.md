# Bun Standalone Canvas Executable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il lancio del canvas ExcaliClaude da `Node+Express+spawn-Chrome` a un **single-file executable Bun** che incorpora runtime Bun, server Express, frontend pre-buildato e finestra nativa via `webview-bun`. Zero build al primo uso, zero Chrome fallback, zero dipendenza da Bun installato sulla macchina utente.

**Architecture:** Il server `canvas-app` viene scomposto in un core riutilizzabile (`server-core.ts`) + due entrypoint: uno per dev (`server.ts`, tsx watch) e uno per il binary compilato (`canvas-bin.ts`) che unisce server + webview in un unico processo. Il frontend viene embedded via manifest autogenerato (`embedded-frontend.ts`) che scansiona `dist/frontend/` dopo `vite build`. Lo spawn del binary nel `SessionManager` sostituisce lo spawn separato di `start-server.ts` + `open-window.ts`.

**Tech Stack:** Bun 1.x (runtime + compiler), webview-bun 0.8+ (FFI, WebKit/WebView2/GTK), Express 4, WebSocket (`ws`), Vite 6 (frontend bundler), TypeScript 5, tsx (dev), GitHub Actions (CI matrix).

**Split:** Il plan è diviso in due parti indipendenti.
- **Part A (Task 1–12):** POC locale macOS-arm64 → produce software funzionante sul Mac dello sviluppatore. Dopo Part A il canvas si apre in finestra nativa Bun con frontend embedded, senza Chrome.
- **Part B (Task 13–18):** Cross-compile + CI + distribution. Rende il plugin installabile da chiunque via marketplace/git. Può essere eseguita in una sessione separata.

---

## File Structure

**New files:**
- `src/canvas-app/server-core.ts` — Factory `createCanvasApp({ port, sessionId, title, serveFrontendFrom })` che ritorna `{ app, server, wss, close() }`. Contiene tutta la logica route/WebSocket attualmente in `server.ts`. **Nessuna chiamata `server.listen()`**.
- `src/canvas-app/canvas-bin.ts` — Entry per il binary compilato Bun. Importa `server-core` + `embedded-frontend` + `webview-bun`. Usa porta effimera, apre webview WebKit, gestisce shutdown.
- `src/canvas-app/embedded-frontend.ts` — **Generato**. Manifest di import `with { type: "file" }` per ogni file in `dist/frontend/**` + i font Excalidraw. Esporta `staticRoutes: Record<string, Blob>` per `Bun.serve` e un helper `serveStatic(req)` riutilizzabile da Express.
- `scripts/generate-embedded-frontend.ts` — Script Node/Bun che scansiona `dist/frontend/` + `node_modules/@excalidraw/excalidraw/dist/prod/fonts` e scrive `src/canvas-app/embedded-frontend.ts`.
- `scripts/build-bin.ts` — Orchestratore: `vite build` → `generate-embedded-frontend` → `bun build --compile`. Accetta `--target` CLI arg.
- `scripts/postinstall.mjs` — **Part B**. Detect `process.platform`/`arch`, scarica il binary giusto dalla GitHub Release corrispondente alla versione del package.
- `.github/workflows/release-bin.yml` — **Part B**. Matrix cross-compile (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64), upload asset alla Release.

**Modified files:**
- `src/canvas-app/server.ts` — Refattorizzato: importa `server-core`, serve frontend da `dist/frontend/` via path risolto con `findProjectRoot()`. Fix del bug `../dist/frontend` → `../../dist/frontend` via project root. Mantiene `server.listen()` come dev entry.
- `src/canvas-app/start-server.ts` — Invariato o minore cleanup: resta il dev wrapper che importa `./server.js`.
- `src/canvas-app/open-window.ts` — **Deprecato ma mantenuto** come fallback per versioni post-migrazione prive di binary (non cancellato in Part A, cancellato in Part B dopo il postinstall download).
- `src/mcp/session-manager.ts` — Nuovo metodo `spawnCanvasBinary(port, sessionId, title)` + nuova strategia: tenta binary → fallback a processo doppio legacy. `ensureFrontendBuilt()` resta come fallback dev-only.
- `package.json` — Sposta `webview-bun` in `devDependencies` (usata solo a build time del binary). Aggiunge `bun-types` in `devDependencies`. Aggiunge scripts: `build:bin`, `build:bin:all`, `gen:embedded`. Aggiunge `files: [... "dist/bin"]` per includere i binary nel tarball.
- `.gitignore` — Aggiunge `src/canvas-app/embedded-frontend.ts` e `dist/bin/`.
- `.github/workflows/build.yml` — **Part B**. Estende con matrix per cross-compile.
- `vite.config.ts` — Invariato (gli hash nei chunk name sono OK, il manifest li mappa 1:1).

**Test files:**
Questo progetto attualmente non ha una test suite. Per questo plan useremo **verifica manuale end-to-end** documentata in ogni task (`Verifica:` con comando + output atteso). Una test suite automatizzata è fuori scope — può essere un plan successivo.

---

## Prerequisites

- macOS (darwin-arm64) per Part A
- Git pulito (nessuna modifica non committata)
- `node >= 18` e `npm` già presenti
- Connessione internet (per `curl` dell'installer Bun)
- Accesso al repo GitHub con permessi write (per Part B)

---

# PART A — Local POC (macOS-arm64)

## Task 1: Install Bun runtime locally

**Files:** none (installazione di sistema)

- [ ] **Step 1: Verifica che Bun non sia già installato**

Run: `which bun || echo "not found"`
Expected: `not found`

- [ ] **Step 2: Installa Bun via script ufficiale**

Run: `curl -fsSL https://bun.sh/install | bash`
Expected: output che finisce con `bun was installed successfully to ~/.bun/bin/bun`

- [ ] **Step 3: Aggiungi Bun al PATH della shell corrente**

Per fish (la shell dell'utente):
```fish
set -Ux BUN_INSTALL "$HOME/.bun"
set -U fish_user_paths $BUN_INSTALL/bin $fish_user_paths
```

- [ ] **Step 4: Verifica l'installazione**

Run: `bun --version`
Expected: `1.x.y` (qualsiasi versione >= 1.1)

- [ ] **Step 5: Commit (nessuna modifica al repo, skip)**

---

## Task 2: Add webview-bun + bun-types + runtime deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Installa webview-bun in devDependencies**

Dal root del progetto:
```bash
npm install --save-dev webview-bun@^0.8.0
```

Nota: spostiamo da `optionalDependencies` a `devDependencies` perché viene usato solo a build time del binary.

- [ ] **Step 2: Installa bun-types in devDependencies**

```bash
npm install --save-dev bun-types
```

- [ ] **Step 3: Rimuovi la vecchia entry optionalDependencies**

Modifica manualmente `package.json`: rimuovi il blocco
```json
"optionalDependencies": {
  "webview-bun": "^0.8.0"
},
```

- [ ] **Step 4: Aggiungi `bun-types` al tsconfig types**

Leggi `tsconfig.json`. Se ha un array `compilerOptions.types`, aggiungi `"bun-types"`. Altrimenti aggiungi:
```json
"compilerOptions": {
  ...
  "types": ["node", "bun-types"]
}
```

- [ ] **Step 5: Verifica che tsc compila ancora**

Run: `npx tsc --noEmit`
Expected: zero errori

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: move webview-bun to devDependencies, add bun-types"
```

---

## Task 3: Fix frontend path bug in legacy dev server (safety net)

**Files:**
- Modify: `src/canvas-app/server.ts:34-53,1154-1174`

- [ ] **Step 1: Aggiungi helper findProjectRoot in server.ts**

Inserisci dopo la linea 35 (`const __dirname = path.dirname(__filename);`):

```ts
import fs from 'fs';

/** Risale da __dirname finché trova package.json (la project root). */
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
const FONTS_DIR = path.join(PROJECT_ROOT, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts');
```

- [ ] **Step 2: Sostituisci i path hard-coded**

Trova:
```ts
const staticDir = path.join(__dirname, '../dist');
app.use(express.static(staticDir));
// Also serve frontend assets
app.use(express.static(path.join(__dirname, '../dist/frontend')));
// Serve Excalidraw fonts so the font subsetting worker can fetch them for export
app.use('/assets/fonts', express.static(
  path.join(__dirname, '../node_modules/@excalidraw/excalidraw/dist/prod/fonts')
));
```

Sostituisci con:
```ts
app.use(express.static(FRONTEND_DIR));
app.use('/assets/fonts', express.static(FONTS_DIR));
```

- [ ] **Step 3: Sostituisci il path di GET /**

Trova (linea ~1156):
```ts
const htmlFile = path.join(__dirname, '../dist/frontend/index.html');
```
Sostituisci con:
```ts
const htmlFile = path.join(FRONTEND_DIR, 'index.html');
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errori

- [ ] **Step 5: Build dev**

Run: `npm run build:server && npm run build:frontend`
Expected: `dist/mcp/index.js`, `dist/canvas-app/server.js`, `dist/frontend/index.html` esistono

- [ ] **Step 6: Smoke test manuale del vecchio path**

Run: `PORT=3199 node dist/canvas-app/start-server.js &` poi `curl -s http://localhost:3199/ | head -5`
Expected: HTML di Excalidraw (NON la pagina "frontend non ancora pronto")
Poi: `curl -s http://localhost:3199/health`
Expected: JSON con `"status":"healthy"`
Infine: `kill %1`

- [ ] **Step 7: Commit**

```bash
git add src/canvas-app/server.ts
git commit -m "fix(canvas): resolve frontend dir via findProjectRoot, not relative to __dirname"
```

---

## Task 4: Extract server core into server-core.ts

**Files:**
- Create: `src/canvas-app/server-core.ts`
- Modify: `src/canvas-app/server.ts` (diventa solo dev entry)

- [ ] **Step 1: Crea server-core.ts con la firma factory**

```ts
// src/canvas-app/server-core.ts
// Factory riutilizzabile per l'app canvas. Nessuna chiamata listen() —
// il caller (server.ts dev entry oppure canvas-bin.ts prod binary) decide
// come startare il server HTTP.

import express, { Express } from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer, Server as HttpServer } from 'http';

export interface CanvasAppOptions {
  sessionId?: string;
  title?: string;
  /** Directory da cui servire static frontend (dev mode). Opzionale. */
  serveStaticFrom?: string;
  /** Directory da cui servire i font Excalidraw (dev mode). Opzionale. */
  fontsDir?: string;
  /** Handler custom per GET / (prod binary serve da embedded). Opzionale. */
  rootHandler?: (req: express.Request, res: express.Response) => void;
  /** Handler custom per static asset (prod binary). Opzionale. */
  staticHandler?: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
}

export interface CanvasApp {
  app: Express;
  server: HttpServer;
  wss: WebSocketServer;
  close(): Promise<void>;
}

export function createCanvasApp(options: CanvasAppOptions = {}): CanvasApp {
  const app = express();
  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server });

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // All route registrations go here — spostate da server.ts
  // (vedi step successivi)

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { app, server, wss, close };
}
```

- [ ] **Step 2: Sposta tutto il corpo di server.ts dentro createCanvasApp**

Sposta dal vecchio `server.ts` (linee ~56–1547) dentro la factory `createCanvasApp` in `server-core.ts`, mantenendo esattamente lo stesso ordine. Punti chiave:
- WebSocket handlers (`wss.on('connection', ...)`)
- Schema Zod (`CreateElementSchema`, ...)
- Helpers (`resolveArrowBindings`, `normalizeLineBreakMarkup`, ...)
- Tutte le route `app.get/post/put/delete` per `/api/elements`, `/api/files`, `/api/claude/*`, `/api/export/*`, `/api/import`, `/api/sync/*`, `/health`
- Route `/assets/fonts` → usa `options.fontsDir` se fornito, else skip
- Route `GET /` → usa `options.rootHandler` se fornito, else usa il fallback "frontend non ancora pronto"
- Static middleware → usa `options.serveStaticFrom` se fornito, altrimenti skip

Le variabili mutable come `elements`, `files`, `snapshots`, `clients`, `pendingSignalResolvers`, `claudeMessages`, `changeLog` restano importate da `'../mcp/types.js'` (sono già module-scoped global singletons) o dichiarate come module-level const dentro server-core.ts.

**Nota importante:** le variabili `elements`, `files`, `snapshots` vengono da `../mcp/types.js` — confermare con grep. I singleton `clients`, `pendingSignalResolvers`, `claudeMessages`, `changeLog` erano module-level in server.ts: vanno spostati dentro la factory come const inside-closure, altrimenti 2 istanze di canvas condividono state.

- [ ] **Step 3: Rendi server.ts un thin dev entry**

Sovrascrivi `src/canvas-app/server.ts` con:

```ts
// src/canvas-app/server.ts — Dev entry (tsx watch).
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

const { server } = createCanvasApp({
  sessionId: process.env.EXCALICLAUDE_SESSION_ID,
  title: process.env.EXCALICLAUDE_SESSION_TITLE,
  serveStaticFrom: FRONTEND_DIR,
  fontsDir: FONTS_DIR,
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, HOST, () => {
  logger.info(`Canvas dev server running on http://${HOST}:${PORT}`);
});

export default server;
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errori. Se ci sono errori su variabili non risolte dentro server-core, spostare dichiarazioni come descritto nello Step 2.

- [ ] **Step 5: Smoke test dev entry**

Run: `npm run build:server && PORT=3199 node dist/canvas-app/start-server.js &` (sleep 1), poi `curl -s http://localhost:3199/health` e `curl -s http://localhost:3199/api/elements`.
Expected: entrambi rispondono JSON. `kill %1`

- [ ] **Step 6: Commit**

```bash
git add src/canvas-app/server-core.ts src/canvas-app/server.ts
git commit -m "refactor(canvas): extract server core into createCanvasApp factory"
```

---

## Task 5: Generate embedded-frontend.ts manifest script

**Files:**
- Create: `scripts/generate-embedded-frontend.ts`
- Modify: `.gitignore`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Aggiungi `src/canvas-app/embedded-frontend.ts` a .gitignore**

Append a `.gitignore`:
```
# Generated by scripts/generate-embedded-frontend.ts
src/canvas-app/embedded-frontend.ts
dist/bin/
```

- [ ] **Step 2: Crea scripts/generate-embedded-frontend.ts**

```ts
#!/usr/bin/env node
// Scansiona dist/frontend/** + i font Excalidraw e genera
// src/canvas-app/embedded-frontend.ts con un import per ogni asset.
// Eseguito prima di `bun build --compile` in scripts/build-bin.ts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
const OUTPUT = path.join(PROJECT_ROOT, 'src', 'canvas-app', 'embedded-frontend.ts');

interface Entry {
  relImport: string;   // Path usato nel source ts, relativo a embedded-frontend.ts
  varName: string;     // Identificatore JS valido
  urlPath: string;     // Path servito via HTTP (es. '/assets/fonts/foo.woff2')
}

function walkFiles(dir: string, baseUrl: string): { absPath: string; urlPath: string }[] {
  const out: { absPath: string; urlPath: string }[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const url = path.posix.join(baseUrl, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, url));
    } else if (entry.isFile()) {
      out.push({ absPath: abs, urlPath: url });
    }
  }
  return out;
}

function sanitizeVarName(rel: string): string {
  return '_' + rel.replace(/[^A-Za-z0-9]/g, '_');
}

function main(): void {
  if (!fs.existsSync(FRONTEND_DIR)) {
    console.error(`[gen:embedded] ERROR: ${FRONTEND_DIR} not found. Run \`npm run build:frontend\` first.`);
    process.exit(1);
  }

  const entries: Entry[] = [];
  const embeddedFileDir = path.dirname(OUTPUT);

  // Frontend files (dist/frontend/**) → served at '/'
  for (const { absPath, urlPath } of walkFiles(FRONTEND_DIR, '/')) {
    const relImport = path
      .relative(embeddedFileDir, absPath)
      .split(path.sep)
      .join('/');
    const varName = sanitizeVarName(urlPath);
    entries.push({ relImport: './' + relImport, varName, urlPath });
  }

  // Font files → served at '/assets/fonts/*'
  for (const { absPath, urlPath } of walkFiles(FONTS_DIR, '/assets/fonts/')) {
    const relImport = path
      .relative(embeddedFileDir, absPath)
      .split(path.sep)
      .join('/');
    const varName = sanitizeVarName(urlPath);
    entries.push({ relImport: './' + relImport, varName, urlPath });
  }

  const banner = [
    '// AUTO-GENERATED by scripts/generate-embedded-frontend.ts — DO NOT EDIT.',
    '// Regenerate with: npm run gen:embedded',
    '',
  ].join('\n');

  const imports = entries
    .map((e) => `import ${e.varName} from '${e.relImport}' with { type: 'file' };`)
    .join('\n');

  const map = entries
    .map((e) => `  '${e.urlPath}': ${e.varName},`)
    .join('\n');

  const body = `
import { file } from 'bun';

// Path → embedded file path (prefixed \$bunfs/ in compiled binary).
const paths: Record<string, string> = {
${map}
};

/** Ritorna un Bun.file() per il path HTTP richiesto, o null. */
export function getEmbeddedFile(urlPath: string): ReturnType<typeof file> | null {
  const normalized = urlPath === '/' ? '/index.html' : urlPath.split('?')[0];
  const p = paths[normalized];
  return p ? file(p) : null;
}

export const embeddedPaths = paths;
`;

  const content = banner + imports + '\n' + body;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, content);
  console.log(`[gen:embedded] Wrote ${entries.length} entries to ${path.relative(PROJECT_ROOT, OUTPUT)}`);
}

main();
```

- [ ] **Step 3: Aggiungi script `gen:embedded` in package.json**

Dentro `"scripts": { ... }` aggiungi:
```json
"gen:embedded": "tsx scripts/generate-embedded-frontend.ts",
```

- [ ] **Step 4: Build frontend e genera manifest**

```bash
npm run build:frontend
npm run gen:embedded
```
Expected output: `[gen:embedded] Wrote N entries to src/canvas-app/embedded-frontend.ts` con N > 100 (frontend + font).

- [ ] **Step 5: Verifica che il file generato è valido TypeScript**

```bash
head -5 src/canvas-app/embedded-frontend.ts
wc -l src/canvas-app/embedded-frontend.ts
```
Expected: header auto-generated + 200+ linee di import.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-embedded-frontend.ts .gitignore package.json
git commit -m "feat(build): add generator for embedded-frontend manifest"
```

---

## Task 6: Create canvas-bin.ts (prod binary entry)

**Files:**
- Create: `src/canvas-app/canvas-bin.ts`

- [ ] **Step 1: Scrivi canvas-bin.ts**

```ts
#!/usr/bin/env bun
// ExcaliClaude — Standalone Canvas Binary
//
// Compilato con `bun build --compile` in un single-file executable che
// contiene:
//  - runtime Bun
//  - server Express + WebSocket (via server-core.ts)
//  - frontend Excalidraw embedded (via embedded-frontend.ts)
//  - webview-bun (nativa WebKit/WebView2/GTK)
//
// Lanciato dal SessionManager con env vars PORT, SESSION_ID, SESSION_TITLE,
// WINDOW_WIDTH, WINDOW_HEIGHT. Quando la finestra viene chiusa, il processo
// termina (sia server che webview).

import { createCanvasApp } from './server-core.js';
import { getEmbeddedFile, embeddedPaths } from './embedded-frontend.js';
import type { Request, Response, NextFunction } from 'express';

function parseArg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const PORT = parseInt(process.env.PORT || parseArg('--port', '3100'), 10);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_ID = process.env.SESSION_ID || parseArg('--session-id', 'default');
const SESSION_TITLE = process.env.SESSION_TITLE || parseArg('--title', 'ExcaliClaude');
const WINDOW_WIDTH = parseInt(process.env.WINDOW_WIDTH || parseArg('--width', '1280'), 10);
const WINDOW_HEIGHT = parseInt(process.env.WINDOW_HEIGHT || parseArg('--height', '800'), 10);

async function serveEmbedded(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const blob = getEmbeddedFile(req.path);
  if (!blob) return next();
  const mime = blob.type || guessMime(req.path);
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const buf = Buffer.from(await blob.arrayBuffer());
  res.status(200).send(buf);
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

async function main(): Promise<void> {
  const { app, server } = createCanvasApp({
    sessionId: SESSION_ID,
    title: SESSION_TITLE,
    rootHandler: (req, res) => serveEmbedded(req, res, () => res.status(404).end()),
    staticHandler: (req, res, next) => serveEmbedded(req, res, next),
  });

  // Mount the embedded handler as last-chance static route
  app.use((req, res, next) => serveEmbedded(req, res, next));

  await new Promise<void>((resolve) => server.listen(PORT, HOST, () => resolve()));
  console.error(`[canvas-bin] Session ${SESSION_ID} listening on http://${HOST}:${PORT}`);

  // Dynamic import so the binary can still boot if webview-bun native libs
  // are unavailable (degraded mode: prints URL, no window).
  let Webview: any;
  try {
    ({ Webview } = await import('webview-bun'));
  } catch (err) {
    console.error(`[canvas-bin] webview-bun unavailable: ${err}`);
    console.error(`[canvas-bin] Server running headless on http://${HOST}:${PORT}`);
    // Keep server alive until killed
    await new Promise(() => {});
    return;
  }

  const webview = new Webview();
  webview.title = `ExcaliClaude — ${SESSION_TITLE}`;
  if (typeof webview.size === 'object') {
    webview.size = { width: WINDOW_WIDTH, height: WINDOW_HEIGHT, hint: 0 };
  }
  webview.navigate(`http://${HOST}:${PORT}`);
  webview.run(); // blocking — returns when window closes

  console.error(`[canvas-bin] Window closed, shutting down`);
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[canvas-bin] Fatal: ${err}`);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check canvas-bin.ts**

Run: `npx tsc --noEmit`
Expected: zero errori. Possibili errori:
- `Cannot find module 'webview-bun'` → webview-bun installato? (vedi Task 2)
- `bun` module resolution → assicurati `bun-types` sia in tsconfig

- [ ] **Step 3: Commit**

```bash
git add src/canvas-app/canvas-bin.ts
git commit -m "feat(canvas): add canvas-bin.ts as bun-compile entry point"
```

---

## Task 7: Build script for local bun compile

**Files:**
- Create: `scripts/build-bin.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Scrivi scripts/build-bin.ts**

```ts
#!/usr/bin/env node
// Orchestratore: vite build → generate-embedded-frontend → bun build --compile.
// Default target = platform corrente. Override con `--target bun-<os>-<arch>`.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function currentTarget(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin' && a === 'arm64') return 'bun-darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'bun-darwin-x64';
  if (p === 'linux' && a === 'arm64') return 'bun-linux-arm64';
  if (p === 'linux' && a === 'x64') return 'bun-linux-x64';
  if (p === 'win32' && a === 'x64') return 'bun-windows-x64';
  throw new Error(`Unsupported platform: ${p}-${a}`);
}

function run(cmd: string, env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit', env });
}

function which(bin: string): string | null {
  try {
    return execSync(`which ${bin}`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main(): void {
  const target = arg('--target') || currentTarget();
  const suffix = target.replace(/^bun-/, '');
  const outDir = path.join(PROJECT_ROOT, 'dist', 'bin');
  const outFile = path.join(outDir, `canvas-${suffix}${target.includes('windows') ? '.exe' : ''}`);

  const bunBin = which('bun');
  if (!bunBin) {
    console.error('ERROR: bun not found in PATH. Install via https://bun.sh');
    process.exit(1);
  }

  console.log(`[build-bin] target=${target}`);
  console.log(`[build-bin] out=${path.relative(PROJECT_ROOT, outFile)}`);

  // 1) Frontend bundle
  run('npm run build:frontend');

  // 2) Regen embedded manifest
  run('npm run gen:embedded');

  // 3) Bun compile
  fs.mkdirSync(outDir, { recursive: true });
  const entry = path.join('src', 'canvas-app', 'canvas-bin.ts');
  const flags = [
    'build',
    '--compile',
    '--minify',
    '--sourcemap',
    `--target=${target}`,
    entry,
    '--outfile',
    outFile,
  ];
  run(`${bunBin} ${flags.join(' ')}`);

  const stat = fs.statSync(outFile);
  console.log(`\n✓ Built ${outFile} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main();
```

- [ ] **Step 2: Aggiungi script in package.json**

Dentro `"scripts"`:
```json
"build:bin": "tsx scripts/build-bin.ts",
```

- [ ] **Step 3: Build locale macOS-arm64**

Run: `npm run build:bin`
Expected: output che termina con `✓ Built .../dist/bin/canvas-darwin-arm64 (XX.X MB)`. Dimensione attesa 60-100 MB.

Se fallisce su `bun build --compile` con errori di sintassi/import, probabilmente `bun-types` non è nel tsconfig — verifica Task 2 Step 4.

- [ ] **Step 4: Verifica che il binary è eseguibile**

```bash
file dist/bin/canvas-darwin-arm64
ls -lh dist/bin/canvas-darwin-arm64
```
Expected: `Mach-O 64-bit executable arm64`, size ~60-100MB, permesso `x`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-bin.ts package.json
git commit -m "feat(build): add build-bin.ts orchestrator (vite + gen + bun compile)"
```

---

## Task 8: Smoke test the binary manually

**Files:** none

- [ ] **Step 1: Lancia il binary headless (senza webview) su porta test**

```bash
PORT=3201 SESSION_ID=smoke SESSION_TITLE=Test ./dist/bin/canvas-darwin-arm64 &
sleep 2
```
Expected: output `[canvas-bin] Session smoke listening on http://127.0.0.1:3201`.
Se la webview si apre davvero (macOS apre una finestra), chiudila dopo aver verificato lo step 2.

- [ ] **Step 2: Verifica endpoint API**

```bash
curl -s http://127.0.0.1:3201/health
curl -s http://127.0.0.1:3201/api/elements
curl -sI http://127.0.0.1:3201/ | head -5
```
Expected: `/health` ritorna JSON `status:healthy`, `/api/elements` ritorna array vuoto, `/` ritorna `200 OK` con `Content-Type: text/html`.

- [ ] **Step 3: Verifica che il frontend embedded è servito**

```bash
curl -s http://127.0.0.1:3201/ | grep -i excalidraw | head -3
```
Expected: trova riferimenti a "excalidraw" nell'HTML.

- [ ] **Step 4: Cleanup**

```bash
pkill -f canvas-darwin-arm64 || true
```

- [ ] **Step 5: Commit (nessuna modifica, skip)**

---

## Task 9: Refactor SessionManager to prefer binary spawn

**Files:**
- Modify: `src/mcp/session-manager.ts:114-282`

- [ ] **Step 1: Aggiungi helper findCanvasBinary**

Inserisci dopo `ensureFrontendBuilt()`:

```ts
/**
 * Cerca il binary `canvas-<platform>-<arch>` compilato in dist/bin/.
 * Ritorna il path assoluto o null se non trovato.
 */
private findCanvasBinary(): string | null {
  const projectRoot = this.findProjectRoot();
  const p = process.platform;
  const a = process.arch;

  const map: Record<string, string> = {
    'darwin-arm64': 'canvas-darwin-arm64',
    'darwin-x64': 'canvas-darwin-x64',
    'linux-arm64': 'canvas-linux-arm64',
    'linux-x64': 'canvas-linux-x64',
    'win32-x64': 'canvas-windows-x64.exe',
  };
  const name = map[`${p}-${a}`];
  if (!name) return null;

  const candidate = path.join(projectRoot, 'dist', 'bin', name);
  return fs.existsSync(candidate) ? candidate : null;
}
```

- [ ] **Step 2: Aggiungi spawnCanvasBinary**

Inserisci dopo `findCanvasBinary()`:

```ts
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
  });

  return proc;
}
```

- [ ] **Step 3: Modifica createSession per preferire il binary**

Sostituisci il corpo del metodo `createSession` (linee 114–196) con:

```ts
async createSession(options: CreateSessionOptions): Promise<CanvasSession> {
  const id = (webcrypto as any).randomUUID();
  const port = this.nextPort++;
  const url = `http://localhost:${port}`;

  // Prefer binary (single process: server + window)
  const binaryProcess = this.spawnCanvasBinary(port, id, options.title);

  let serverProcess: ChildProcess | null = binaryProcess;
  let windowProcess: ChildProcess | null = binaryProcess;

  if (!binaryProcess) {
    // Legacy dev fallback: separate server + window processes
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

    serverProcess = spawn(runtime, [startScript], {
      env: { ...process.env, PORT: String(port), SESSION_ID: id, SESSION_TITLE: options.title },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    serverProcess.stdout?.on('data', (d) => logger.debug(`[canvas:${port}] ${d}`));
    serverProcess.stderr?.on('data', (d) => logger.debug(`[canvas:${port}:err] ${d}`));
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
    } catch (err) {
      logger.warn(`[SessionManager] Could not load ${options.loadFrom}: ${err}`);
    }
  }

  // Only open a separate window if we're in fallback mode (binary already opens its own)
  if (!binaryProcess) {
    session.windowProcess = await this.openWindow(url, options.title, id);
  }

  session.status = 'ready';
  return session;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errori

- [ ] **Step 5: Rebuild MCP server**

Run: `npm run build:server`
Expected: `dist/mcp/session-manager.js` aggiornato.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/session-manager.ts
git commit -m "feat(mcp): prefer canvas binary over legacy 2-process spawn"
```

---

## Task 10: End-to-end test via Claude Code

**Files:** none

- [ ] **Step 1: Conferma che tutti gli artefatti sono presenti**

```bash
ls -lh dist/bin/canvas-darwin-arm64 dist/mcp/index.js dist/frontend/index.html
```
Expected: tutti e tre esistono.

- [ ] **Step 2: Riavvia Claude Code (sessione corrente)**

L'utente deve ricaricare il plugin. Consigliato: `/exit` dalla CLI Claude Code, riaprire la cartella, riavviare una sessione.

- [ ] **Step 3: Triggera open_canvas**

Da una conversazione Claude Code in questo repo, chiedere: "apri un canvas vuoto".
Expected:
- Nessuna pagina "frontend non ancora pronto"
- Finestra nativa WebKit (NON Chrome) con titolo "ExcaliClaude — Empty Canvas"
- Excalidraw visibile
- Sidebar Claude a destra

- [ ] **Step 4: Test interazione bidirezionale**

Nella conversazione: `send_message_to_canvas "hello"`. Expected: messaggio appare nella sidebar.
Nel canvas: disegna un rettangolo, clicca "👀 Claude, guarda!". Expected: `wait_for_human` risponde con summary contenente "1 rectangle".

- [ ] **Step 5: Chiudi canvas**

Chiudi la finestra nativa. Verifica con `ps aux | grep canvas` che il processo binary è terminato.

- [ ] **Step 6: Commit (nessuna modifica, skip)**

---

## Task 11: Update .gitignore + README per il nuovo flow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Aggiungi sezione "Build" al README**

Inserisci dopo la sezione esistente di installazione:

```markdown
## Build

### Dev mode
```bash
npm install
npm run build          # server + frontend
npm run dev:canvas     # tsx watch canvas server
npm run dev            # vite frontend + tsc watch
```

### Standalone binary
Il canvas runtime viene distribuito come singolo eseguibile Bun che
incorpora runtime, server, frontend e webview nativa.

```bash
# Install Bun (one-time)
curl -fsSL https://bun.sh/install | bash

# Build binary per la platform corrente
npm run build:bin
# → dist/bin/canvas-<platform>-<arch>
```

Il `SessionManager` rileva automaticamente il binary in `dist/bin/` e lo
preferisce allo spawn legacy a 2 processi.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add build section for bun standalone binary"
```

---

## Task 12: Verify Part A is stable — full rebuild from clean state

**Files:** none

- [ ] **Step 1: Clean build artifacts**

```bash
rm -rf dist node_modules src/canvas-app/embedded-frontend.ts
npm ci
```

- [ ] **Step 2: Full rebuild**

```bash
npm run build
npm run build:bin
```
Expected: tutto builda senza errori, `dist/bin/canvas-darwin-arm64` esiste.

- [ ] **Step 3: Smoke test binary**

```bash
PORT=3210 ./dist/bin/canvas-darwin-arm64 &
sleep 2
curl -sf http://127.0.0.1:3210/health
pkill -f canvas-darwin-arm64
```
Expected: `curl` ritorna 200 con JSON healthy.

- [ ] **Step 4: Tag il commit Part A**

```bash
git tag -a part-a-complete -m "Part A: local bun standalone canvas working"
```

**Nota:** non pushare il tag senza autorizzazione esplicita dell'utente.

---

# PART B — Cross-compile + CI + Distribution

> Part B richiede che Part A sia stabile e validata. Se Part A fallisce su alcuni aspetti, fixare prima di iniziare Part B.

## Task 13: Define cross-compile matrix

**Files:**
- Modify: `scripts/build-bin.ts`
- Create: `scripts/build-bin-all.ts`

- [ ] **Step 1: Crea scripts/build-bin-all.ts**

```ts
#!/usr/bin/env node
// Builds all cross-compile targets sequentially.
// Used by GitHub Actions matrix as fallback / for local "build-everything" flow.

import { execSync } from 'child_process';

const TARGETS = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-windows-x64',
];

for (const target of TARGETS) {
  console.log(`\n=== Building ${target} ===`);
  try {
    execSync(`tsx scripts/build-bin.ts --target ${target}`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`✗ Failed: ${target}`);
    process.exit(1);
  }
}
console.log('\n✓ All targets built');
```

- [ ] **Step 2: Aggiungi script in package.json**

```json
"build:bin:all": "tsx scripts/build-bin-all.ts",
```

- [ ] **Step 3: Test cross-compile locale (solo 2 target per sanity check)**

```bash
tsx scripts/build-bin.ts --target bun-darwin-arm64
tsx scripts/build-bin.ts --target bun-darwin-x64
ls -lh dist/bin/
```
Expected: entrambi i file esistono.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-bin-all.ts package.json
git commit -m "feat(build): add build-bin-all orchestrator for cross-compile"
```

---

## Task 14: GitHub Actions — build matrix job

**Files:**
- Create: `.github/workflows/release-bin.yml`

- [ ] **Step 1: Scrivi il workflow**

```yaml
name: Release Canvas Binaries

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build-binary:
    strategy:
      fail-fast: false
      matrix:
        include:
          - target: bun-darwin-arm64
            os: macos-14
          - target: bun-darwin-x64
            os: macos-13
          - target: bun-linux-x64
            os: ubuntu-latest
          - target: bun-linux-arm64
            os: ubuntu-latest
          - target: bun-windows-x64
            os: ubuntu-latest
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install deps
        run: npm ci --no-audit --no-fund

      - name: Build TS + frontend
        run: |
          npm run build:server
          npm run build:frontend

      - name: Generate embedded manifest
        run: npm run gen:embedded

      - name: Compile binary
        run: tsx scripts/build-bin.ts --target ${{ matrix.target }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: canvas-${{ matrix.target }}
          path: dist/bin/canvas-*
          retention-days: 7

  release:
    needs: build-binary
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts/

      - name: Flatten artifacts
        run: |
          mkdir -p release
          find artifacts -type f -name 'canvas-*' -exec cp {} release/ \;
          ls -lh release/

      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: release/canvas-*
          generate_release_notes: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release-bin.yml
git commit -m "ci: add cross-compile matrix workflow for canvas binaries"
```

- [ ] **Step 3: Push branch (NOT tag) — verifica sintassi workflow**

```bash
git push origin main
```
Naviga in GitHub Actions UI, verifica che il workflow appare con sintassi valida. **Non creare tag ancora.**

- [ ] **Step 4: Trigger manuale workflow_dispatch**

Da GitHub UI: Actions → Release Canvas Binaries → Run workflow.
Expected: 5 job paralleli, tutti verdi dopo 5-15 minuti. Scarica gli artifact e verifica presenza di 5 binary.

Se qualche target fallisce:
- **linux-arm64 su ubuntu-latest**: richiede QEMU o Bun cross-compile (dovrebbe funzionare nativamente, cfr. docs Bun)
- **windows**: il binary ha suffisso `.exe`, verificare che `build-bin.ts` lo aggiunga

---

## Task 15: Postinstall script — download binary per piattaforma corrente

**Files:**
- Create: `scripts/postinstall.mjs`
- Modify: `package.json` (scripts.postinstall, files)

- [ ] **Step 1: Scrivi postinstall.mjs**

```js
#!/usr/bin/env node
// Eseguito automaticamente da npm/bun/yarn dopo `npm install`.
// Scarica il canvas binary per la platform corrente dalla GitHub Release
// corrispondente alla versione del package, se non già presente.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = `v${pkg.version}`;
const REPO = 'ttessarolo/excaliclaude';

function platformSuffix() {
  const p = process.platform;
  const a = process.arch;
  const map = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'linux-arm64': 'linux-arm64',
    'linux-x64': 'linux-x64',
    'win32-x64': 'windows-x64.exe',
  };
  const key = `${p}-${a}`;
  if (!map[key]) {
    console.warn(`[postinstall] Unsupported platform ${key}, skipping binary download`);
    return null;
  }
  return map[key];
}

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          return resolve(download(res.headers.location, dest, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
  });
}

async function main() {
  if (process.env.EXCALICLAUDE_SKIP_POSTINSTALL === '1') {
    console.log('[postinstall] Skipped via env var');
    return;
  }

  const suffix = platformSuffix();
  if (!suffix) return;

  const outDir = path.join(PROJECT_ROOT, 'dist', 'bin');
  const outName = `canvas-${suffix}`;
  const outPath = path.join(outDir, outName);

  if (fs.existsSync(outPath)) {
    console.log(`[postinstall] Binary already present: ${outName}`);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const url = `https://github.com/${REPO}/releases/download/${VERSION}/${outName}`;
  console.log(`[postinstall] Downloading ${url}`);
  try {
    await download(url, outPath);
    if (!outName.endsWith('.exe')) fs.chmodSync(outPath, 0o755);
    const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
    console.log(`[postinstall] ✓ Installed ${outName} (${size} MB)`);
  } catch (err) {
    console.error(`[postinstall] ✗ Download failed: ${err.message}`);
    console.error(`[postinstall] The canvas will fall back to dev mode (requires npm run build + npm run build:bin locally).`);
    // Do not fail the install — degraded mode is acceptable
  }
}

main();
```

- [ ] **Step 2: Aggiungi postinstall in package.json**

```json
"scripts": {
  ...
  "postinstall": "node scripts/postinstall.mjs"
}
```

- [ ] **Step 3: Aggiungi `scripts/` ai files**

In `package.json`:
```json
"files": [
  "dist",
  "scripts",
  "skills",
  ".claude-plugin",
  ".mcp.json",
  "README.md",
  "LICENSE"
]
```

- [ ] **Step 4: Test postinstall locale (con binary già presente → skip)**

```bash
node scripts/postinstall.mjs
```
Expected: `[postinstall] Binary already present: canvas-darwin-arm64`

- [ ] **Step 5: Test postinstall con binary assente**

```bash
mv dist/bin/canvas-darwin-arm64 /tmp/canvas.bak
node scripts/postinstall.mjs
```
Expected: `Downloading https://github.com/ttessarolo/excaliclaude/releases/download/v0.1.0/canvas-darwin-arm64` → probabile 404 finché non esiste la release. Il comando NON deve fallire (`Download failed` warning, exit 0).

Ripristina:
```bash
mv /tmp/canvas.bak dist/bin/canvas-darwin-arm64
```

- [ ] **Step 6: Commit**

```bash
git add scripts/postinstall.mjs package.json
git commit -m "feat(install): postinstall script downloads canvas binary from GH release"
```

---

## Task 16: Cut release v0.2.0 and validate end-to-end

**Files:**
- Modify: `package.json` (version)

- [ ] **Step 1: Bump version**

Edit `package.json`: `"version": "0.2.0"`.

- [ ] **Step 2: Commit version bump**

```bash
git add package.json
git commit -m "chore: release v0.2.0 (bun standalone canvas)"
```

- [ ] **Step 3: Chiedi all'utente conferma prima di taggare e pushare**

Il tag triggera il release workflow che crea una GitHub Release pubblica. Conferma esplicita richiesta.

- [ ] **Step 4: Tag + push (solo dopo conferma)**

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

- [ ] **Step 5: Monitor workflow**

Apri GitHub Actions UI. Attendi che `release-bin` completi tutti i 5 job + il job `release` che fa upload.
Expected: Release v0.2.0 su GitHub con 5 binary attached.

- [ ] **Step 6: Test install pulito da npm/git tarball**

In una dir temporanea:
```bash
cd /tmp
mkdir test-install && cd test-install
npm install ttessarolo/excaliclaude#v0.2.0
ls node_modules/excaliclaude/dist/bin/
```
Expected: `canvas-darwin-arm64` presente (scaricato dal postinstall).

---

## Task 17: Cleanup legacy paths

**Files:**
- Modify: `src/canvas-app/open-window.ts` (delete or keep as docs)
- Modify: `src/mcp/session-manager.ts` (remove dead openWindow branch if binary is always available)
- Modify: `.github/workflows/build.yml` (merge with release-bin.yml or document)

- [ ] **Step 1: Valuta se open-window.ts è ancora necessario**

Dopo Task 16, se tutti i target sono coperti dal binary, `open-window.ts` è morto. Decidi:
- **Keep**: come fallback didattico / per contributors senza Bun
- **Delete**: codice morto

Consigliato: **keep** con un comment block che spiega che è legacy e quando si attiva.

- [ ] **Step 2: Se delete, rimuovi il file e il branch fallback in session-manager**

```bash
git rm src/canvas-app/open-window.ts
```

E semplifica `createSession` in session-manager.ts rimuovendo il ramo `!binaryProcess`.

- [ ] **Step 3: Merge o consolida i workflow CI**

Decidi se `build.yml` (MCP build legacy) ha ancora senso dopo `release-bin.yml`. Consigliato: tenere `build.yml` per i PR (veloce, senza cross-compile) e `release-bin.yml` solo su tag.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: cleanup legacy canvas spawn paths post-bun-migration"
```

---

## Task 18: Update README + skill docs

**Files:**
- Modify: `README.md`
- Modify: `skills/excaliclaude/SKILL.md` (se menziona setup/build)

- [ ] **Step 1: Aggiorna README per riflettere la nuova install UX**

La sezione install diventa:
```markdown
## Install

Via Claude Code plugin marketplace — **zero dipendenze locali richieste**.
Il postinstall scarica automaticamente il canvas binary per la tua piattaforma
dalla GitHub Release corrispondente alla versione del plugin.

Platforms supportate: macOS (arm64, x64), Linux (arm64, x64), Windows (x64).

### Dev setup (contributors)
```bash
git clone https://github.com/ttessarolo/excaliclaude
cd excaliclaude
npm install
curl -fsSL https://bun.sh/install | bash
npm run build
npm run build:bin
```
```

- [ ] **Step 2: Verifica SKILL.md non menziona build manuale**

Run: `grep -i "npm run build\|bun install" skills/excaliclaude/SKILL.md`
Se trovi riferimenti, sostituiscili con un generico "assicurati che il binary sia stato scaricato dal postinstall".

- [ ] **Step 3: Commit**

```bash
git add README.md skills/excaliclaude/SKILL.md
git commit -m "docs: update install instructions for bun standalone binary flow"
```

---

## Out of scope (future plans)

- **Automated test suite** per server-core (unit + integration con supertest)
- **Code-signing** dei binary macOS (richiede Apple Developer cert)
- **Binary notarization** per macOS Gatekeeper
- **Automatic updates** (in-app self-update del binary)
- **Binary size optimization** (tree-shake del frontend, ev. split mermaid lazy)
- **Headless CI mode** per il canvas (senza webview, solo HTTP) come target separato

---

## Self-review checklist

- [x] Fix del bug path esistente incluso in Task 3 (safety net per dev mode)
- [x] Ogni task ha file path espliciti con linee
- [x] Codice completo in ogni step che modifica codice
- [x] Commit message per ogni task
- [x] Part A produce software funzionante (Task 10 e Task 12 validano end-to-end)
- [x] Part B è isolabile (non blocca Part A)
- [x] Platform detection consistente (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-x64`)
- [x] Naming coerente: `canvas-<os>-<arch>` ovunque (senza prefisso `bun-`)
- [x] Nessun riferimento a tipi/funzioni non definiti nei task precedenti
- [x] Rischio noto: `bun build --compile` con file hash vite → risolto via manifest esplicito
- [x] Rischio noto: webview-bun native libs → docs confermano supporto per `bun compile`
- [x] Rischio noto: postinstall 404 prima della prima release → degraded mode, non fail

# ExcaliClaude — Piano di Implementazione

## Obiettivo

Creare **ExcaliClaude**, un plugin per Claude Code che abilita sessioni interattive bidirezionali umano ↔ Claude su un canvas Excalidraw. L'utente lavora principalmente dal canvas, dialogando con Claude direttamente dall'interfaccia Excalidraw. Claude risponde sia testualmente (in un pannello integrato nel canvas) sia visivamente (aggiungendo, modificando, annotando elementi).

**Base di partenza:** Fork di [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw) — già 26 tool MCP, WebSocket bidirezionale, canvas Excalidraw live.

---

## Architettura Target

```
                        ┌─────────────────────────┐
                        │    Claude Code CLI       │
                        │    (MCP Client)          │
                        └───────────┬─────────────┘
                                    │ MCP Protocol (stdio)
                                    ▼
                        ┌─────────────────────────┐
                        │  ExcaliClaude MCP Server │
                        │  (Node.js / TypeScript)  │
                        │                          │
                        │  • 26 tool esistenti     │
                        │  • 8 nuovi tool sessione │
                        │  • Session Manager       │
                        │  • Process Spawner       │
                        └───────────┬─────────────┘
                                    │ HTTP + WebSocket
                                    ▼
              ┌──────────────────────────────────────────┐
              │     Canvas App (Bun standalone process)   │
              │     1 processo per sessione               │
              │     Porta dinamica (3100, 3101, ...)      │
              │                                           │
              │  ┌─────────────────────────────────────┐  │
              │  │  Excalidraw React + Claude Panel     │  │
              │  │                                      │  │
              │  │  ┌───────────┐  ┌─────────────────┐  │  │
              │  │  │ Canvas    │  │ Claude Sidebar   │  │  │
              │  │  │ Excalidraw│  │                  │  │  │
              │  │  │           │  │ • Chat thread    │  │  │
              │  │  │ Umano +   │  │ • Input field    │  │  │
              │  │  │ Claude    │  │ • Status         │  │  │
              │  │  │ disegnano │  │ • Session info   │  │  │
              │  │  │ insieme   │  │ • "Claude,       │  │  │
              │  │  │           │  │    guarda!"      │  │  │
              │  │  └───────────┘  └─────────────────┘  │  │
              │  └─────────────────────────────────────┘  │
              └──────────────────────────────────────────┘
```

### Principio chiave: Multi-Sessione con Finestre Native

Ogni sessione è un **processo Bun indipendente** che apre una **finestra nativa
del sistema operativo** (non un tab browser). Usa la webview nativa dell'OS
(WebKit su macOS/Linux, WebView2/Edge su Windows) tramite la libreria
**webview-bun**. L'MCP Server gestisce un registry di sessioni attive.

Questo permette:
- Più istanze Claude Code che lavorano su canvas diversi simultaneamente
- Ogni canvas è una finestra standalone con titolo proprio
- Isolamento completo tra sessioni
- Cleanup automatico quando una sessione viene chiusa
- Nessun browser richiesto all'utente — la webview è parte dell'OS

### Alternativa: Modalità Browser Fallback

Se `webview-bun` non è disponibile (dipendenze native mancanti), il sistema
fa fallback a **Chrome/Edge in app-mode** (`--app=URL`), che apre una finestra
senza barra degli indirizzi, tab o chrome — visivamente identica a un'app nativa.
Come ulteriore fallback, apre il browser di default.

---

## Struttura del Progetto (Target)

```
excaliclaude/
├── .claude-plugin/
│   └── plugin.json                    # Manifest plugin Claude Code
├── .mcp.json                          # Configurazione MCP server
├── skills/
│   └── excaliclaude/
│       ├── SKILL.md                   # Istruzioni per Claude
│       └── references/
│           ├── interaction-protocol.md # Protocollo di interazione dettagliato
│           └── canvas-patterns.md     # Pattern per diagrammi comuni
├── src/
│   ├── mcp/
│   │   ├── index.ts                   # Entry point MCP server
│   │   ├── tools/
│   │   │   ├── element-tools.ts       # Tool CRUD elementi (da yctimlin)
│   │   │   ├── layout-tools.ts        # Tool layout (da yctimlin)
│   │   │   ├── export-tools.ts        # Tool export (da yctimlin)
│   │   │   ├── inspect-tools.ts       # Tool ispezione (da yctimlin)
│   │   │   └── session-tools.ts       # NUOVI tool sessione
│   │   ├── session-manager.ts         # Gestione sessioni + spawn processi
│   │   └── types.ts                   # Tipi TypeScript
│   └── canvas-app/
│       ├── server.ts                  # Express + WebSocket server
│       ├── start.ts                   # Entry point Bun standalone
│       ├── frontend/
│       │   ├── index.html
│       │   ├── src/
│       │   │   ├── main.tsx
│       │   │   ├── App.tsx            # Excalidraw + Claude Panel
│       │   │   ├── components/
│       │   │   │   ├── ClaudeSidebar.tsx    # Sidebar integrata
│       │   │   │   ├── ChatThread.tsx       # Thread messaggi Claude
│       │   │   │   ├── ChatInput.tsx        # Input per messaggi umano
│       │   │   │   ├── SessionStatus.tsx    # Stato sessione/turno
│       │   │   │   └── CanvasAnnotation.tsx # Annotazioni Claude inline
│       │   │   ├── hooks/
│       │   │   │   ├── useWebSocket.ts      # Hook WebSocket
│       │   │   │   ├── useSession.ts        # Hook gestione sessione
│       │   │   │   └── useClaudeMessages.ts # Hook messaggi Claude
│       │   │   ├── styles/
│       │   │   │   └── claude-theme.css     # Stili integrati
│       │   │   └── utils/
│       │   │       ├── element-author.ts    # Tracking autore elementi
│       │   │       └── mermaidConverter.ts  # Da yctimlin
│       │   └── vite.config.ts
│       └── package.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## FASE 1 — Setup e Fork (Giorno 1-2)

### 1.1 Inizializzazione progetto

```bash
# Clona yctimlin/mcp_excalidraw come base
git clone https://github.com/yctimlin/mcp_excalidraw.git excaliclaude
cd excaliclaude
git remote rename origin upstream
git remote add origin <tuo-repo>

# Riorganizza la struttura
mkdir -p src/mcp/tools
mkdir -p src/canvas-app/frontend
mkdir -p skills/excaliclaude/references
mkdir -p .claude-plugin
```

### 1.2 Riorganizzazione file yctimlin

Spostare i file esistenti nella nuova struttura:

| Da (yctimlin) | A (excaliclaude) | Note |
|---|---|---|
| `src/index.ts` | `src/mcp/index.ts` | Splitta i tool in moduli separati |
| `src/server.ts` | `src/canvas-app/server.ts` | Aggiungi session-awareness |
| `src/types.ts` | `src/mcp/types.ts` | Estendi con tipi sessione |
| `src/utils/logger.ts` | `src/mcp/utils/logger.ts` | Invariato |
| `frontend/*` | `src/canvas-app/frontend/*` | Base per il nuovo frontend |

### 1.3 Split dei tool in moduli

Il file `src/index.ts` originale (~800 righe) va spezzato in moduli:

**`src/mcp/tools/element-tools.ts`** — Esporta funzioni per registrare:
- `create_element`, `update_element`, `delete_element`, `get_element`
- `batch_create_elements`, `duplicate_elements`, `query_elements`

**`src/mcp/tools/layout-tools.ts`** — Esporta funzioni per registrare:
- `align_elements`, `distribute_elements`, `group_elements`, `ungroup_elements`
- `lock_elements`, `unlock_elements`

**`src/mcp/tools/export-tools.ts`** — Esporta funzioni per registrare:
- `export_scene`, `import_scene`, `export_to_image`
- `export_to_excalidraw_url`, `create_from_mermaid`

**`src/mcp/tools/inspect-tools.ts`** — Esporta funzioni per registrare:
- `describe_scene`, `get_canvas_screenshot`, `snapshot_scene`, `restore_snapshot`
- `clear_canvas`, `set_viewport`, `read_diagram_guide`

**`src/mcp/tools/session-tools.ts`** — NUOVO, vedi Fase 2.

**`src/mcp/index.ts`** — Entry point MCP, importa e registra tutti i moduli tool:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerElementTools } from "./tools/element-tools.js";
import { registerLayoutTools } from "./tools/layout-tools.js";
import { registerExportTools } from "./tools/export-tools.js";
import { registerInspectTools } from "./tools/inspect-tools.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { SessionManager } from "./session-manager.js";

const server = new McpServer({ name: "excaliclaude", version: "0.1.0" });
const sessionManager = new SessionManager();

registerElementTools(server, sessionManager);
registerLayoutTools(server, sessionManager);
registerExportTools(server, sessionManager);
registerInspectTools(server, sessionManager);
registerSessionTools(server, sessionManager);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 1.4 Ogni tool deve diventare session-aware

Nell'architettura originale, tutti i tool fanno HTTP a un unico `EXPRESS_SERVER_URL`. Nella nuova architettura, ogni tool riceve `session_id` come parametro opzionale e il `SessionManager` risolve l'URL corretto:

```typescript
// Prima (yctimlin):
const response = await fetch(`${EXPRESS_SERVER_URL}/api/elements`, ...);

// Dopo (excaliclaude):
const baseUrl = sessionManager.getSessionUrl(session_id);
const response = await fetch(`${baseUrl}/api/elements`, ...);
```

Se `session_id` non è fornito, usa la sessione attiva corrente (ultima aperta o unica esistente).

---

## FASE 2 — Session Manager + Multi-processo Bun (Giorno 3-5)

### 2.1 SessionManager (`src/mcp/session-manager.ts`)

Questa è la classe centrale che gestisce il ciclo di vita delle sessioni canvas.

```typescript
interface CanvasSession {
  id: string;                    // UUID
  title: string;                 // Titolo leggibile
  port: number;                  // Porta assegnata
  process: ChildProcess | null;  // Processo Bun
  status: "starting" | "ready" | "closed";
  createdAt: Date;
  lastActivity: Date;
  savePath?: string;             // Path per il salvataggio .excalidraw
  elements: number;              // Conteggio elementi corrente
}

class SessionManager {
  private sessions: Map<string, CanvasSession> = new Map();
  private nextPort: number = 3100;
  private activeSessionId: string | null = null;

  // Crea una nuova sessione, spawna il processo Bun, aspetta ready
  async createSession(options: {
    title: string;
    blank?: boolean;           // default: true
    loadFrom?: string;         // path a file .excalidraw da caricare
    savePath?: string;         // dove salvare alla chiusura
  }): Promise<CanvasSession>;

  // Chiude una sessione, opzionalmente salva lo stato
  async closeSession(sessionId: string, save?: boolean): Promise<void>;

  // Restituisce l'URL base per una sessione
  getSessionUrl(sessionId?: string): string;

  // Lista sessioni attive
  listSessions(): CanvasSession[];

  // Imposta sessione attiva
  setActiveSession(sessionId: string): void;

  // Health check di una sessione
  async pingSession(sessionId: string): Promise<boolean>;

  // Cleanup di tutte le sessioni (su shutdown MCP)
  async cleanup(): Promise<void>;
}
```

### 2.2 Spawn del processo Canvas (Finestra Nativa)

Ogni sessione avvia **due processi**:
1. Un **server Express** (HTTP + WebSocket) che gestisce lo stato del canvas
2. Una **finestra nativa webview** che mostra l'app Excalidraw

```typescript
async createSession(options): Promise<CanvasSession> {
  const id = crypto.randomUUID();
  const port = this.nextPort++;
  const url = `http://localhost:${port}`;

  // 1. Spawna il canvas server (HTTP + WS)
  const serverProcess = spawn(this.getRuntime(), [
    path.join(__dirname, "../canvas-app/start-server.ts"),
    "--port", String(port),
    "--session-id", id,
    "--title", options.title,
  ], {
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_ID: id,
      SESSION_TITLE: options.title,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Aspetta che il server sia pronto
  await this.waitForReady(port, 10_000); // timeout 10s

  // Se loadFrom è specificato, carica il file .excalidraw
  if (options.loadFrom) {
    const content = await fs.readFile(options.loadFrom, "utf-8");
    const scene = JSON.parse(content);
    await fetch(`${url}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scene),
    });
  }

  // 2. Apri la finestra nativa (o fallback browser)
  const windowProcess = await this.openWindow(url, options.title, id);

  const session: CanvasSession = {
    id, title: options.title, port,
    serverProcess, windowProcess,
    status: "ready", createdAt: new Date(),
    lastActivity: new Date(), savePath: options.savePath,
    elements: 0,
  };

  this.sessions.set(id, session);
  this.activeSessionId = id;
  return session;
}
```

### 2.3 Apertura Finestra: 3 livelli di fallback

Il `SessionManager` tenta di aprire una finestra nell'ordine più nativo
possibile, con fallback automatici:

```typescript
// In session-manager.ts

private async openWindow(
  url: string, title: string, sessionId: string
): Promise<ChildProcess | null> {

  // ── Livello 1: webview-bun (finestra OS nativa) ──────────
  // Usa la webview nativa dell'OS: WebKit (macOS/Linux), WebView2 (Windows)
  // Nessun browser coinvolto. Risultato: finestra app dedicata.
  try {
    const windowProcess = spawn(this.getRuntime(), [
      path.join(__dirname, "../canvas-app/open-window.ts"),
      "--url", url,
      "--title", `ExcaliClaude — ${title}`,
      "--width", "1280",
      "--height", "800",
      "--session-id", sessionId,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Verifica che il processo parta senza errori
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 2000);
      windowProcess.on("error", () => {
        clearTimeout(timeout);
        reject(new Error("webview-bun not available"));
      });
    });

    logger.info(`Window opened via webview-bun for session ${sessionId}`);
    return windowProcess;
  } catch {
    logger.warn("webview-bun not available, trying Chrome app-mode");
  }

  // ── Livello 2: Chrome/Edge in app-mode ───────────────────
  // Apre una finestra Chrome SENZA barra indirizzi, tab, o chrome.
  // Visivamente identica a un'app nativa.
  const chromePaths = this.findChromePaths();
  for (const chromePath of chromePaths) {
    try {
      const proc = spawn(chromePath, [
        `--app=${url}`,
        `--window-size=1280,800`,
        `--window-name=ExcaliClaude — ${title}`,
        "--disable-extensions",
        "--disable-default-apps",
      ], { stdio: "ignore", detached: true });
      proc.unref();
      logger.info(`Window opened via Chrome app-mode for session ${sessionId}`);
      return proc;
    } catch { continue; }
  }

  // ── Livello 3: browser di default ────────────────────────
  // Fallback finale: apre nel browser di default
  const open = await import("open");
  await open.default(url);
  logger.info(`Window opened via default browser for session ${sessionId}`);
  return null;
}

private findChromePaths(): string[] {
  const platform = process.platform;
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  } else if (platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
  } else {
    return ["google-chrome", "chromium-browser", "chromium", "microsoft-edge"];
  }
}
```

### 2.4 Script Finestra Nativa (`src/canvas-app/open-window.ts`)

Questo script è il processo che gestisce la finestra nativa webview:

```typescript
#!/usr/bin/env bun

// src/canvas-app/open-window.ts
// Processo standalone che apre una finestra OS nativa con webview-bun

import { Webview } from "webview-bun";

const url = process.env.WINDOW_URL || parseArg("--url");
const title = parseArg("--title") || "ExcaliClaude";
const width = parseInt(parseArg("--width") || "1280");
const height = parseInt(parseArg("--height") || "800");

const webview = new Webview();

// Configura la finestra
webview.title = title;
webview.size = { width, height, hint: 0 }; // 0 = resizable

// Naviga all'URL del canvas server locale
webview.navigate(url);

// Binding JS: permette al frontend di comunicare col processo window
// (es. per chiudere la finestra, cambiare titolo, etc.)
webview.bind("excaliclaude_close", () => {
  webview.destroy();
  process.exit(0);
});

webview.bind("excaliclaude_setTitle", (newTitle: string) => {
  webview.title = newTitle;
});

// Blocca navigazione verso URL esterni (sicurezza)
// Il webview dovrebbe rimanere su localhost

// Avvia il loop della finestra (blocking)
webview.run();

// Quando la finestra viene chiusa, termina il processo
process.exit(0);

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
```

### 2.5 Entry Point Server (separato dalla finestra)

```typescript
#!/usr/bin/env bun

// src/canvas-app/start-server.ts
// Avvia SOLO il server Express + WebSocket (senza finestra)
// La finestra è gestita da un processo separato (open-window.ts)

import { startCanvasServer } from "./server.ts";

const port = parseInt(process.env.PORT || "3100");
const sessionId = process.env.SESSION_ID || "default";
const title = process.env.SESSION_TITLE || "ExcaliClaude";

const server = startCanvasServer({ port, sessionId, title });

// Gestisci shutdown graceful
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
```
```

### 2.3 Canvas App Entry Point (`src/canvas-app/start.ts`)

```typescript
#!/usr/bin/env bun

import { startCanvasServer } from "./server.ts";

const port = parseInt(process.env.PORT || "3100");
const sessionId = process.env.SESSION_ID || "default";
const title = process.env.SESSION_TITLE || "ExcaliClaude";

startCanvasServer({ port, sessionId, title });
```

### 2.4 Nuovi Tool Sessione (`src/mcp/tools/session-tools.ts`)

```typescript
export function registerSessionTools(server: McpServer, sm: SessionManager) {

  // ── open_canvas ──────────────────────────────────────────────
  // Apre un nuovo canvas vuoto o carica un file .excalidraw esistente
  server.tool("open_canvas", {
    title: z.string().describe("Titolo della sessione canvas"),
    blank: z.boolean().optional().default(true)
      .describe("true per canvas vuoto, false per caricare da file"),
    load_from: z.string().optional()
      .describe("Path al file .excalidraw da caricare"),
    save_path: z.string().optional()
      .describe("Path dove salvare la sessione al termine"),
  }, async (params) => {
    const session = await sm.createSession({
      title: params.title,
      blank: params.blank,
      loadFrom: params.load_from,
      savePath: params.save_path,
    });
    return {
      content: [{
        type: "text",
        text: `Canvas "${session.title}" aperto su http://localhost:${session.port}\nSession ID: ${session.id}`,
      }],
    };
  });

  // ── close_canvas ─────────────────────────────────────────────
  // Chiude una sessione, salva opzionalmente
  server.tool("close_canvas", {
    session_id: z.string().optional(),
    save: z.boolean().optional().default(true),
  }, async (params) => {
    await sm.closeSession(params.session_id, params.save);
    return { content: [{ type: "text", text: "Sessione chiusa." }] };
  });

  // ── list_sessions ────────────────────────────────────────────
  server.tool("list_sessions", {}, async () => {
    const sessions = sm.listSessions();
    return {
      content: [{
        type: "text",
        text: sessions.map(s =>
          `[${s.id}] "${s.title}" — port ${s.port} — ${s.elements} elementi — ${s.status}`
        ).join("\n") || "Nessuna sessione attiva.",
      }],
    };
  });

  // ── wait_for_human ───────────────────────────────────────────
  // Tool BLOCKING: aspetta che l'umano segnali "Claude, guarda!"
  // Ritorna lo stato del canvas + eventuale messaggio dall'umano
  server.tool("wait_for_human", {
    session_id: z.string().optional(),
    timeout_ms: z.number().optional().default(300_000)
      .describe("Timeout in ms (default: 5 minuti)"),
  }, async (params) => {
    const baseUrl = sm.getSessionUrl(params.session_id);

    // Apre un long-poll verso il canvas server
    // Il canvas server risolve quando l'umano clicca "Claude, guarda!"
    const response = await fetch(
      `${baseUrl}/api/claude/wait-for-signal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout_ms: params.timeout_ms }),
        signal: AbortSignal.timeout(params.timeout_ms + 5000),
      }
    );

    const result = await response.json();

    // result contiene:
    // {
    //   signal_type: "look" | "message" | "timeout",
    //   message?: string,           // messaggio testuale dall'umano
    //   canvas_summary: string,     // describe_scene output
    //   changed_elements: [...],    // elementi modificati dall'ultimo check
    //   screenshot_base64?: string, // screenshot opzionale
    // }

    const content = [];

    if (result.signal_type === "timeout") {
      content.push({ type: "text", text: "Timeout: l'umano non ha segnalato." });
    } else {
      if (result.message) {
        content.push({ type: "text", text: `Messaggio dall'umano: ${result.message}` });
      }
      content.push({ type: "text", text: `Stato canvas:\n${result.canvas_summary}` });

      if (result.screenshot_base64) {
        content.push({
          type: "image",
          data: result.screenshot_base64,
          mimeType: "image/png",
        });
      }
    }

    return { content };
  });

  // ── save_session ─────────────────────────────────────────────
  // Salva lo stato corrente del canvas come file .excalidraw
  server.tool("save_session", {
    session_id: z.string().optional(),
    path: z.string().describe("Path dove salvare il file .excalidraw"),
    include_png: z.boolean().optional().default(false)
      .describe("Salva anche un PNG accanto al file"),
  }, async (params) => {
    const baseUrl = sm.getSessionUrl(params.session_id);

    // Recupera lo stato completo del canvas
    const sceneResponse = await fetch(`${baseUrl}/api/export/scene`);
    const scene = await sceneResponse.json();

    // Scrivi il file .excalidraw
    // NOTA: il file viene scritto dall'MCP server, non dal canvas
    // Questo perché l'MCP server ha accesso al filesystem del progetto
    return {
      content: [{
        type: "text",
        text: JSON.stringify(scene),
        // Claude Code leggerà questo contenuto e lo scriverà su disco
        // Alternativa: restituiamo il path e Claude usa il tool Write
      }],
      // Metadato per indicare a Claude di salvare il contenuto
      _save_hint: {
        path: params.path,
        format: "excalidraw",
      },
    };
  });

  // ── send_message_to_canvas ───────────────────────────────────
  // Invia un messaggio testuale di Claude visibile nella sidebar del canvas
  server.tool("send_message_to_canvas", {
    session_id: z.string().optional(),
    message: z.string().describe("Messaggio di Claude da mostrare nel canvas"),
    type: z.enum(["info", "question", "suggestion", "action"])
      .optional().default("info"),
  }, async (params) => {
    const baseUrl = sm.getSessionUrl(params.session_id);
    await fetch(`${baseUrl}/api/claude/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: params.message,
        type: params.type,
        timestamp: new Date().toISOString(),
      }),
    });
    return {
      content: [{ type: "text", text: "Messaggio inviato al canvas." }],
    };
  });

  // ── annotate ─────────────────────────────────────────────────
  // Crea un'annotazione testuale di Claude accanto a un elemento esistente
  server.tool("annotate", {
    session_id: z.string().optional(),
    target_element_id: z.string().optional()
      .describe("ID elemento a cui agganciare l'annotazione"),
    text: z.string().describe("Testo dell'annotazione"),
    position: z.enum(["top", "right", "bottom", "left", "auto"])
      .optional().default("auto"),
    style: z.enum(["note", "comment", "highlight", "question"])
      .optional().default("comment"),
  }, async (params) => {
    const baseUrl = sm.getSessionUrl(params.session_id);

    // Crea un gruppo di elementi Excalidraw che rappresentano l'annotazione:
    // 1. Un rettangolo arrotondato con sfondo Claude (#F0EDFF)
    // 2. Un testo dentro il rettangolo
    // 3. Una freccia tratteggiata dall'annotazione all'elemento target
    const response = await fetch(`${baseUrl}/api/claude/annotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_element_id: params.target_element_id,
        text: params.text,
        position: params.position,
        style: params.style,
      }),
    });

    const result = await response.json();
    return {
      content: [{
        type: "text",
        text: `Annotazione creata (${result.elements_created} elementi).`,
      }],
    };
  });

  // ── get_human_changes ────────────────────────────────────────
  // Restituisce gli elementi modificati dall'umano dall'ultimo check
  server.tool("get_human_changes", {
    session_id: z.string().optional(),
    since: z.string().optional()
      .describe("Timestamp ISO dall'ultimo check (auto se omesso)"),
  }, async (params) => {
    const baseUrl = sm.getSessionUrl(params.session_id);
    const response = await fetch(
      `${baseUrl}/api/claude/human-changes${params.since ? `?since=${params.since}` : ""}`
    );
    const changes = await response.json();
    return {
      content: [{
        type: "text",
        text: changes.summary || "Nessuna modifica dall'ultimo check.",
      }],
    };
  });
}
```

---

## FASE 3 — Frontend: Claude Sidebar Integrata (Giorno 6-10)

Questa è la fase più critica per la UX. L'obiettivo è un'integrazione che sembri **nativa** di Excalidraw, non un pannello appiccicato.

### 3.1 Design System

**Palette Claude integrata in Excalidraw:**

```css
:root {
  /* Claude brand — sottile, non invadente */
  --claude-bg: #F8F6FF;           /* Sfondo sidebar */
  --claude-bg-hover: #F0EDFF;     /* Hover su elementi */
  --claude-accent: #7C5CFC;       /* Accento principale */
  --claude-accent-soft: #B8A9FC;  /* Accento secondario */
  --claude-text: #1A1523;         /* Testo primario */
  --claude-text-muted: #6E6680;   /* Testo secondario */
  --claude-border: #E8E4F0;       /* Bordi */
  --claude-success: #34D399;      /* Azioni completate */
  --claude-annotation-bg: rgba(124, 92, 252, 0.08);

  /* Stile elementi Claude sul canvas */
  --claude-element-stroke: #7C5CFC;
  --claude-element-bg: rgba(124, 92, 252, 0.06);
  --claude-annotation-stroke: #B8A9FC;
}
```

**Font:** Usare lo stesso font di Excalidraw (Virgil per hand-drawn, Assistant per UI) per seamless integration.

### 3.2 App.tsx — Integrazione con Excalidraw

Il componente principale monta Excalidraw con il Claude panel come sidebar custom:

```tsx
// src/canvas-app/frontend/src/App.tsx

import { Excalidraw } from "@excalidraw/excalidraw";
import { ClaudeSidebar } from "./components/ClaudeSidebar";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSession } from "./hooks/useSession";
import { useClaudeMessages } from "./hooks/useClaudeMessages";
import { trackElementAuthor } from "./utils/element-author";

export default function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { ws, connected } = useWebSocket();
  const session = useSession();
  const claude = useClaudeMessages(ws);

  // Traccia autore degli elementi (claude vs human)
  const handleChange = useCallback((elements, appState, files) => {
    trackElementAuthor(elements, "human");
    // Debounce sync verso il server (come yctimlin originale)
    debouncedSync(elements, files);
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      {/* Canvas principale */}
      <div style={{ flex: 1, position: "relative" }}>
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={handleChange}
          renderTopRightUI={(isMobile, appState) => (
            <ClaudeTopButton
              onClick={() => setSidebarOpen(!sidebarOpen)}
              hasUnread={claude.hasUnread}
              isConnected={connected}
            />
          )}
          UIOptions={{
            dockedSidebarBreakpoint: 0, // Gestiamo noi la sidebar
          }}
          initialData={{
            appState: {
              viewBackgroundColor: "#FFFFFF",
              currentItemStrokeColor: "#1e1e1e",
              theme: "light",
            },
          }}
        />
      </div>

      {/* Claude Sidebar */}
      {sidebarOpen && (
        <ClaudeSidebar
          ws={ws}
          session={session}
          messages={claude.messages}
          onSendSignal={(type, message) => {
            ws.send(JSON.stringify({
              type: "human_signal",
              signal_type: type,
              message,
              timestamp: new Date().toISOString(),
            }));
          }}
          onClose={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
```

### 3.3 ClaudeSidebar (`src/canvas-app/frontend/src/components/ClaudeSidebar.tsx`)

La sidebar è il cuore dell'interazione. Design principi:
- Larghezza fissa 360px, ridimensionabile
- Stile che si fonde con la UI di Excalidraw
- Bordo sinistro sottile, nessuna separazione aggressiva

```tsx
export function ClaudeSidebar({ ws, session, messages, onSendSignal, onClose }) {
  return (
    <aside className="claude-sidebar">
      {/* Header con titolo sessione e status */}
      <header className="claude-sidebar-header">
        <div className="session-info">
          <h3>{session.title}</h3>
          <span className="session-status">
            {session.status === "ready" ? "🟢 Connesso" : "🔴 Disconnesso"}
          </span>
        </div>
        <button onClick={onClose} className="close-btn" aria-label="Chiudi">×</button>
      </header>

      {/* Thread messaggi */}
      <ChatThread messages={messages} />

      {/* Area input con bottoni azione */}
      <footer className="claude-sidebar-footer">
        <ChatInput
          onSend={(text) => onSendSignal("message", text)}
          placeholder="Scrivi a Claude..."
        />
        <div className="signal-buttons">
          <button
            className="signal-btn primary"
            onClick={() => onSendSignal("look", null)}
          >
            👀 Claude, guarda!
          </button>
          <button
            className="signal-btn secondary"
            onClick={() => onSendSignal("approve", null)}
          >
            ✅ Approva
          </button>
        </div>
      </footer>
    </aside>
  );
}
```

### 3.4 ChatThread — Messaggi bidirezionali

```tsx
interface ChatMessage {
  id: string;
  sender: "claude" | "human";
  type: "text" | "action" | "question" | "annotation" | "system";
  content: string;
  timestamp: Date;
  elements_affected?: string[];  // ID elementi coinvolti
}

export function ChatThread({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  return (
    <div className="chat-thread">
      {messages.map(msg => (
        <div key={msg.id} className={`chat-message ${msg.sender} ${msg.type}`}>
          {msg.sender === "claude" && (
            <div className="message-avatar">
              <ClaudeIcon size={20} />
            </div>
          )}
          <div className="message-content">
            {msg.type === "action" && (
              <span className="action-badge">
                {msg.type === "action" ? "🎨 Azione" : ""}
              </span>
            )}
            <p>{msg.content}</p>
            {msg.elements_affected?.length > 0 && (
              <button
                className="focus-elements-btn"
                onClick={() => focusOnElements(msg.elements_affected)}
              >
                📍 Mostra sul canvas
              </button>
            )}
          </div>
          <time className="message-time">
            {formatTime(msg.timestamp)}
          </time>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
```

### 3.5 Stile CSS per seamless integration

```css
/* claude-theme.css */

.claude-sidebar {
  width: 360px;
  min-width: 280px;
  max-width: 480px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--claude-bg);
  border-left: 1px solid var(--claude-border);
  font-family: "Assistant", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  color: var(--claude-text);
  /* Transizione apertura/chiusura */
  transition: width 0.2s ease, opacity 0.15s ease;
}

.claude-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--claude-border);
  background: white;
}

.claude-sidebar-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--claude-text);
}

.session-status {
  font-size: 12px;
  color: var(--claude-text-muted);
}

/* Chat thread */
.chat-thread {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-message {
  display: flex;
  gap: 8px;
  max-width: 95%;
  animation: fadeIn 0.15s ease;
}

.chat-message.human {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.chat-message.claude .message-content {
  background: white;
  border: 1px solid var(--claude-border);
  border-radius: 12px 12px 12px 4px;
  padding: 8px 12px;
}

.chat-message.human .message-content {
  background: var(--claude-accent);
  color: white;
  border-radius: 12px 12px 4px 12px;
  padding: 8px 12px;
}

.chat-message.system .message-content {
  background: transparent;
  color: var(--claude-text-muted);
  font-size: 12px;
  text-align: center;
  width: 100%;
  padding: 4px;
}

/* Footer con input e bottoni */
.claude-sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--claude-border);
  background: white;
}

.signal-buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.signal-btn {
  flex: 1;
  padding: 10px 12px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.signal-btn.primary {
  background: var(--claude-accent);
  color: white;
}

.signal-btn.primary:hover {
  background: #6A48E8;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(124, 92, 252, 0.3);
}

.signal-btn.secondary {
  background: var(--claude-bg-hover);
  color: var(--claude-accent);
  border: 1px solid var(--claude-border);
}

/* Focus elements button */
.focus-elements-btn {
  background: none;
  border: none;
  color: var(--claude-accent);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
  margin-top: 4px;
}

.focus-elements-btn:hover {
  text-decoration: underline;
}

/* Animazioni */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Claude Avatar */
.message-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--claude-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
```

---

## FASE 4 — Canvas Server: Nuovi Endpoint (Giorno 6-10, in parallelo con Fase 3)

### 4.1 Nuove route nel Canvas Server (`src/canvas-app/server.ts`)

Aggiungere al server Express esistente:

```typescript
// ── Signal System ───────────────────────────────────────────
// L'umano segnala "Claude, guarda!" → risolve il long-poll del MCP

let pendingSignalResolvers: Array<{
  resolve: (value: any) => void;
  timeout: NodeJS.Timeout;
}> = [];

// POST /api/claude/wait-for-signal
// Long-poll: l'MCP server chiama questo e aspetta che l'umano segnali
app.post("/api/claude/wait-for-signal", async (req, res) => {
  const { timeout_ms = 300_000 } = req.body;

  const promise = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ signal_type: "timeout" });
      // Rimuovi dal pending
      pendingSignalResolvers = pendingSignalResolvers.filter(r => r.resolve !== resolve);
    }, timeout_ms);

    pendingSignalResolvers.push({ resolve, timeout });
  });

  const result = await promise;
  res.json(result);
});

// POST /api/claude/signal (chiamato dal frontend quando l'umano clicca)
app.post("/api/claude/signal", (req, res) => {
  const { signal_type, message } = req.body;

  // Genera summary del canvas
  const summary = generateCanvasSummary(elements);

  // Risolvi tutti i long-poll pendenti
  for (const { resolve, timeout } of pendingSignalResolvers) {
    clearTimeout(timeout);
    resolve({
      signal_type,
      message,
      canvas_summary: summary,
      changed_elements: getRecentChanges(),
      element_count: elements.size,
    });
  }
  pendingSignalResolvers = [];

  res.json({ ok: true });
});

// ── Claude Messages ─────────────────────────────────────────

const claudeMessages: ChatMessage[] = [];

// POST /api/claude/message (MCP → canvas: Claude manda un messaggio)
app.post("/api/claude/message", (req, res) => {
  const msg = {
    id: crypto.randomUUID(),
    sender: "claude" as const,
    ...req.body,
  };
  claudeMessages.push(msg);

  // Broadcast via WebSocket a tutti i client connessi
  broadcast({
    type: "claude_message",
    message: msg,
  });

  res.json({ ok: true, id: msg.id });
});

// GET /api/claude/messages (frontend: recupera storico messaggi)
app.get("/api/claude/messages", (req, res) => {
  res.json(claudeMessages);
});

// ── Annotations ─────────────────────────────────────────────

// POST /api/claude/annotate
app.post("/api/claude/annotate", (req, res) => {
  const { target_element_id, text, position, style } = req.body;

  // Trova l'elemento target per calcolare la posizione
  const target = elements.get(target_element_id);
  const annotationElements = createAnnotationElements({
    target,
    text,
    position,
    style,
    author: "claude",
  });

  // Aggiungi gli elementi al canvas
  for (const el of annotationElements) {
    elements.set(el.id, { ...el, createdAt: new Date(), updatedAt: new Date(), version: 1 });
  }

  // Broadcast
  broadcast({ type: "element_batch_created", elements: annotationElements });

  res.json({
    ok: true,
    elements_created: annotationElements.length,
    annotation_id: annotationElements[0]?.id,
  });
});

// ── Human Changes Tracking ──────────────────────────────────

let changeLog: Array<{
  element_id: string;
  action: "created" | "updated" | "deleted";
  author: "human" | "claude";
  timestamp: Date;
}> = [];

// GET /api/claude/human-changes
app.get("/api/claude/human-changes", (req, res) => {
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);
  const humanChanges = changeLog.filter(
    c => c.author === "human" && c.timestamp > since
  );

  res.json({
    changes: humanChanges,
    summary: summarizeChanges(humanChanges),
    since: since.toISOString(),
    until: new Date().toISOString(),
  });
});
```

### 4.2 Funzione `createAnnotationElements`

Crea un gruppo di elementi Excalidraw che formano un'annotazione Claude:

```typescript
function createAnnotationElements(opts: {
  target?: ServerElement;
  text: string;
  position: "top" | "right" | "bottom" | "left" | "auto";
  style: "note" | "comment" | "highlight" | "question";
  author: "claude";
}): ExcalidrawElement[] {
  const { target, text, position, style } = opts;

  // Calcola posizione relativa al target
  let x: number, y: number;
  if (target) {
    const bounds = getElementBounds(target);
    const offset = 30;
    switch (position === "auto" ? "right" : position) {
      case "right": x = bounds.right + offset; y = bounds.top; break;
      case "left":  x = bounds.left - 250 - offset; y = bounds.top; break;
      case "top":   x = bounds.left; y = bounds.top - 80 - offset; break;
      case "bottom": x = bounds.left; y = bounds.bottom + offset; break;
    }
  } else {
    x = 50; y = 50; // Default position
  }

  // Colori per stile
  const styleColors = {
    note:      { bg: "#F0EDFF", stroke: "#7C5CFC", text: "#1A1523" },
    comment:   { bg: "#FFF8E1", stroke: "#F59E0B", text: "#78350F" },
    highlight: { bg: "#ECFDF5", stroke: "#10B981", text: "#064E3B" },
    question:  { bg: "#EFF6FF", stroke: "#3B82F6", text: "#1E3A5F" },
  };
  const colors = styleColors[style];

  const textWidth = Math.min(Math.max(text.length * 7, 120), 220);
  const textHeight = Math.ceil(text.length / (textWidth / 8)) * 20 + 16;

  const rectId = crypto.randomUUID();
  const textId = crypto.randomUUID();
  const arrowId = crypto.randomUUID();
  const groupId = crypto.randomUUID();

  const elems: any[] = [];

  // 1. Rettangolo contenitore (arrotondato)
  elems.push({
    id: rectId,
    type: "rectangle",
    x, y,
    width: textWidth + 24,
    height: textHeight,
    strokeColor: colors.stroke,
    backgroundColor: colors.bg,
    fillStyle: "solid",
    strokeWidth: 1,
    roundness: { type: 3, value: 8 },
    opacity: 90,
    groupIds: [groupId],
    boundElements: [{ id: textId, type: "text" }],
    customData: { author: "claude", annotation: true, style },
  });

  // 2. Testo dentro il rettangolo
  elems.push({
    id: textId,
    type: "text",
    x: x + 12, y: y + 8,
    width: textWidth,
    height: textHeight - 16,
    text: text,
    fontSize: 14,
    fontFamily: 1, // Virgil (hand-drawn)
    strokeColor: colors.text,
    textAlign: "left",
    verticalAlign: "top",
    groupIds: [groupId],
    containerId: rectId,
    customData: { author: "claude", annotation: true },
  });

  // 3. Freccia tratteggiata verso il target (se esiste)
  if (target) {
    const targetBounds = getElementBounds(target);
    elems.push({
      id: arrowId,
      type: "arrow",
      x: x, y: y + textHeight / 2,
      width: targetBounds.centerX - x,
      height: targetBounds.centerY - (y + textHeight / 2),
      points: [[0, 0], [targetBounds.centerX - x, targetBounds.centerY - (y + textHeight / 2)]],
      strokeColor: colors.stroke,
      strokeStyle: "dashed",
      strokeWidth: 1,
      opacity: 60,
      startBinding: { elementId: rectId, focus: 0, gap: 4 },
      endBinding: { elementId: target.id, focus: 0, gap: 4 },
      customData: { author: "claude", annotation: true },
    });
  }

  return elems;
}
```

### 4.3 WebSocket: Messaggi Bidirezionali Aggiuntivi

Estendere i tipi WebSocket in `src/canvas-app/server.ts`:

```typescript
// Nuovi tipi di messaggio WebSocket (aggiunti a quelli esistenti)
type ExcaliClaudeWSMessage =
  // Esistenti di yctimlin:
  | { type: "initial_elements"; elements: any[] }
  | { type: "element_created"; element: any }
  | { type: "element_updated"; element: any }
  | { type: "element_deleted"; id: string }
  | { type: "element_batch_created"; elements: any[] }
  | { type: "canvas_cleared" }
  | { type: "viewport_changed"; viewport: any }
  // NUOVI per ExcaliClaude:
  | { type: "claude_message"; message: ChatMessage }
  | { type: "human_signal"; signal_type: string; message?: string }
  | { type: "session_info"; session: SessionInfo }
  | { type: "annotation_created"; elements: any[] }
  | { type: "turn_changed"; turn: "human" | "claude" };
```

---

## FASE 5 — Skill SKILL.md (Giorno 11-12)

### 5.1 `skills/excaliclaude/SKILL.md`

```markdown
---
name: excaliclaude
description: >
  Sessione interattiva su canvas Excalidraw bidirezionale.
  Usa questa skill quando l'utente vuole: discutere visivamente di un'idea,
  fare brainstorming su un canvas, disegnare insieme un'architettura,
  creare diagrammi interattivamente, collaborare visivamente su qualsiasi
  concetto. Attiva anche quando l'utente dice "apri un canvas",
  "disegna", "vediamolo visivamente", "facciamo uno sketch",
  "discutiamone su un canvas", "fammi vedere", o qualsiasi variante
  che implichi collaborazione visiva.
---

# ExcaliClaude — Collaborazione Visiva Interattiva

Sei in una sessione di collaborazione visiva con l'umano su un canvas
Excalidraw condiviso. Puoi disegnare, annotare, e comunicare
sia visivamente (sul canvas) che testualmente (nella sidebar del canvas).

## Protocollo di Interazione

Leggi `references/interaction-protocol.md` per il protocollo completo.

### Flusso Base

1. **Apertura:** Quando l'utente chiede di lavorare visivamente,
   usa `open_canvas` con un titolo descrittivo.

2. **Attesa turno:** Dopo aver aperto il canvas o dopo ogni tuo
   intervento, usa `wait_for_human` per aspettare che l'utente
   abbia finito di lavorare sul canvas.

3. **Analisi:** Quando ricevi il segnale dall'umano, analizza
   lo stato del canvas tramite la risposta di `wait_for_human`
   (che include summary e screenshot).

4. **Risposta:** Rispondi sia testualmente (`send_message_to_canvas`)
   che visivamente (usando i tool di disegno e `annotate`).

5. **Iterazione:** Torna al punto 2 fino a conclusione.

6. **Salvataggio:** Alla fine, usa `save_session` per salvare il
   file .excalidraw nella directory del progetto.

### Regole Importanti

- **NON monopolizzare il canvas.** Aspetta sempre il segnale
  dell'umano prima di agire, a meno che non ti venga chiesto
  esplicitamente di procedere in autonomia.
- **Comunica PRIMA di agire.** Usa `send_message_to_canvas` per
  dire cosa stai per fare, poi fallo.
- **Usa annotazioni per commentare** il lavoro dell'umano, non per
  sovrascriverlo. Usa `annotate` con target_element_id per
  collegare i commenti agli elementi specifici.
- **Differenzia visivamente** i tuoi elementi: usa colori dalla
  palette Claude (#7C5CFC come stroke, #F0EDFF come sfondo) per
  le tue aggiunte. Lascia i colori neutri per gli elementi umani.
- **Salva frequentemente** lo stato della sessione per evitare
  perdita di lavoro.
```

### 5.2 `skills/excaliclaude/references/interaction-protocol.md`

```markdown
# Protocollo di Interazione ExcaliClaude

## Scenari

### Scenario A: Umano inizia una discussione visiva

Trigger: "Apri un canvas", "Discutiamo visivamente", "Ho un'idea..."

1. `open_canvas({ title: "<titolo contestuale>", blank: true })`
2. `send_message_to_canvas({ message: "Canvas pronto! Disegna la tua
   idea e clicca '👀 Claude, guarda!' quando vuoi il mio feedback.",
   type: "info" })`
3. `wait_for_human()` — aspetta il segnale
4. Analizza il canvas dalla risposta (canvas_summary + screenshot se
   disponibile)
5. Rispondi con `send_message_to_canvas` + azioni visive

### Scenario B: Claude disegna un'architettura da codice

Trigger: "Disegnami l'architettura", "Mostrami i componenti"

1. Analizza il codebase con gli strumenti standard (Read, Grep, Glob)
2. `open_canvas({ title: "Architettura <progetto>" })`
3. Usa `batch_create_elements` per disegnare i blocchi architetturali
4. Usa `annotate` per aggiungere spiegazioni a ciascun blocco
5. `send_message_to_canvas({ message: "Ecco la mia analisi.
   Modifica pure quello che non ti torna, e clicca '👀 Claude, guarda!'
   quando vuoi che riveda.", type: "info" })`
6. `wait_for_human()` — aspetta feedback
7. Analizza le modifiche dell'umano, itera

### Scenario C: Sessione continuativa

Trigger: "Riapri il canvas di ieri", "Continuiamo il lavoro"

1. `open_canvas({ load_from: "<path>.excalidraw", title: "..." })`
2. `send_message_to_canvas({ message: "Ho ricaricato la sessione
   precedente. Da dove vuoi continuare?", type: "info" })`
3. `wait_for_human()`

## Palette Elementi Claude

Quando crei elementi sul canvas, usa questi stili per distinguerli
da quelli dell'umano:

| Tipo | strokeColor | backgroundColor | strokeStyle |
|------|------------|----------------|-------------|
| Blocco Claude | #7C5CFC | rgba(124,92,252,0.06) | solid |
| Annotazione note | #7C5CFC | #F0EDFF | solid |
| Annotazione domanda | #3B82F6 | #EFF6FF | solid |
| Annotazione highlight | #10B981 | #ECFDF5 | solid |
| Connessione Claude | #B8A9FC | — | dashed |

## Gestione dei Token

Il canvas può diventare grande. Strategie:
- Usa `describe_scene` (testo compatto) come default
- Usa `get_canvas_screenshot` solo quando serve capire il layout visivo
- Per canvas > 50 elementi, chiedi all'umano di indicare l'area su cui
  vuole feedback ("Indica con una selezione l'area che vuoi discutere")

## Tool Reference Rapida

| Tool | Quando usarlo |
|------|--------------|
| `open_canvas` | Inizio sessione |
| `wait_for_human` | Dopo ogni tuo intervento, aspetta turno umano |
| `send_message_to_canvas` | Comunicare nella sidebar del canvas |
| `annotate` | Commentare un elemento specifico dell'umano |
| `create_element` / `batch_create_elements` | Disegnare nuovi elementi |
| `update_element` | Modificare un elemento esistente |
| `delete_element` | Rimuovere un elemento (chiedi prima!) |
| `describe_scene` | Ottenere descrizione testuale del canvas |
| `get_canvas_screenshot` | Screenshot visivo (più costoso in token) |
| `save_session` | Salvare come file .excalidraw |
| `get_human_changes` | Vedere cosa ha modificato l'umano |
```

---

## FASE 6 — Packaging come Plugin Claude Code (Giorno 13-14)

### 6.1 `.claude-plugin/plugin.json`

```json
{
  "name": "excaliclaude",
  "version": "0.1.0",
  "description": "Interactive visual collaboration between human and Claude on an Excalidraw canvas. Open a canvas, draw together, discuss ideas visually.",
  "author": {
    "name": "ttessarolo"
  },
  "keywords": [
    "excalidraw", "canvas", "visual", "collaboration",
    "diagram", "architecture", "brainstorm", "drawing"
  ]
}
```

### 6.2 `.mcp.json`

```json
{
  "mcpServers": {
    "excaliclaude": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/index.js"],
      "env": {
        "CANVAS_APP_PATH": "${CLAUDE_PLUGIN_ROOT}/dist/canvas-app/start.js",
        "EXCALICLAUDE_SESSIONS_DIR": "${CLAUDE_PLUGIN_ROOT}/.sessions"
      }
    }
  }
}
```

### 6.3 Build e distribuzione

```json
// package.json
{
  "name": "excaliclaude",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "bun run build:mcp && bun run build:canvas",
    "build:mcp": "tsc -p tsconfig.mcp.json",
    "build:canvas": "tsc -p tsconfig.canvas.json && vite build --config src/canvas-app/frontend/vite.config.ts",
    "dev": "concurrently \"bun run dev:mcp\" \"bun run dev:canvas\"",
    "dev:mcp": "tsx watch src/mcp/index.ts",
    "dev:canvas": "cd src/canvas-app/frontend && vite",
    "package": "bun run build && zip -r excaliclaude.plugin . -x 'node_modules/*' '.git/*' 'src/*'"
  },
  "dependencies": {
    "@excalidraw/excalidraw": "^0.18.0",
    "@modelcontextprotocol/sdk": "^1.25.0",
    "express": "^5.1.0",
    "ws": "^8.18.0",
    "zod": "^3.23.0",
    "winston": "^3.14.0",
    "open": "^10.1.0",
    "webview-bun": "^0.8.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^9.0.0",
    "tsx": "^4.19.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```
```

---

## Checklist di Completamento

### Fase 1 — Setup e Fork
- [ ] Clone yctimlin/mcp_excalidraw
- [ ] Riorganizza struttura directory
- [ ] Split `src/index.ts` in moduli tool separati
- [ ] Rendi tutti i tool session-aware (parametro `session_id`)
- [ ] Verifica che i 26 tool originali funzionino ancora
- [ ] Test: `npm run dev` avvia MCP + canvas

### Fase 2 — Session Manager + Finestra Nativa
- [ ] Implementa `SessionManager` class
- [ ] Implementa spawn processo Bun per canvas server (start-server.ts)
- [ ] Implementa `open-window.ts` con webview-bun
- [ ] Implementa fallback a Chrome app-mode (`--app=URL`)
- [ ] Implementa fallback a browser di default
- [ ] Implementa assegnazione porta dinamica
- [ ] Implementa tool `open_canvas`
- [ ] Implementa tool `close_canvas`
- [ ] Implementa tool `list_sessions`
- [ ] Implementa tool `wait_for_human` (long-poll)
- [ ] Implementa tool `save_session`
- [ ] Implementa tool `send_message_to_canvas`
- [ ] Implementa tool `annotate`
- [ ] Implementa tool `get_human_changes`
- [ ] Test: aprire 2 sessioni contemporanee su porte diverse in finestre separate

### Fase 3 — Frontend Claude Sidebar
- [ ] Implementa `ClaudeSidebar` component
- [ ] Implementa `ChatThread` component
- [ ] Implementa `ChatInput` component
- [ ] Implementa `SessionStatus` component
- [ ] Implementa `ClaudeTopButton` (toggle sidebar)
- [ ] Implementa CSS `claude-theme.css`
- [ ] Integrare sidebar in `App.tsx` con `renderTopRightUI`
- [ ] Implementa WebSocket handler per messaggi Claude
- [ ] Implementa pulsante "Claude, guarda!" con invio segnale WS
- [ ] Implementa pulsante "Approva"
- [ ] Implementa tracking autore elementi (`customData.author`)
- [ ] Implementa differenziazione visiva elementi Claude vs Human
- [ ] Test: UX completa sidebar funzionante

### Fase 4 — Canvas Server Nuovi Endpoint
- [ ] Implementa `POST /api/claude/wait-for-signal` (long-poll)
- [ ] Implementa `POST /api/claude/signal` (frontend → server)
- [ ] Implementa `POST /api/claude/message`
- [ ] Implementa `GET /api/claude/messages`
- [ ] Implementa `POST /api/claude/annotate`
- [ ] Implementa `GET /api/claude/human-changes`
- [ ] Implementa `createAnnotationElements` helper
- [ ] Implementa change tracking con author attribution
- [ ] Implementa nuovi tipi WebSocket message
- [ ] Test: segnale umano → long-poll resolve → MCP riceve stato

### Fase 5 — Skill
- [ ] Scrivi `SKILL.md` con protocollo di interazione
- [ ] Scrivi `references/interaction-protocol.md`
- [ ] Scrivi `references/canvas-patterns.md`
- [ ] Test: Claude Code usa la skill correttamente nei 3 scenari

### Fase 6 — Packaging
- [ ] Crea `plugin.json` manifest
- [ ] Crea `.mcp.json` configurazione
- [ ] Configura build scripts
- [ ] Test: `claude --plugin-dir ./excaliclaude` funziona
- [ ] Test end-to-end: scenario completo apertura → disegno → salvataggio
- [ ] Scrivi README.md

### Fase 7 — Distribuzione
- [ ] Configura GitHub repo con marketplace.json
- [ ] Configura GitHub Action per build + validazione
- [ ] Verifica installazione da marketplace: `/plugin marketplace add <owner>/excaliclaude`
- [ ] Verifica installazione plugin: `/plugin install excaliclaude@<marketplace>`
- [ ] Testa auto-update
- [ ] (Opzionale) Submit al marketplace ufficiale Anthropic

---

## FASE 7 — Distribuzione e Installazione (Giorno 15-16)

### 7.1 Strategia di Distribuzione

ExcaliClaude è un **plugin Claude Code con MCP server integrato**. La distribuzione
segue il sistema ufficiale dei plugin marketplace di Claude Code.

**Ci sono 3 opzioni di distribuzione**, dalla più semplice alla più completa:

#### Opzione A — GitHub Marketplace (RACCOMANDATA)

Un singolo repository GitHub che funge sia da marketplace che da plugin.
Struttura del repository:

```
excaliclaude/                          # Repository GitHub
├── .claude-plugin/
│   ├── plugin.json                    # Manifest plugin
│   └── marketplace.json               # Catalogo marketplace
├── .mcp.json                          # Configurazione MCP server
├── skills/
│   └── excaliclaude/
│       ├── SKILL.md
│       └── references/
├── src/                               # Codice sorgente
│   ├── mcp/
│   └── canvas-app/
├── dist/                              # Build compilata (in .gitignore? vedi sotto)
│   ├── mcp/
│   └── canvas-app/
├── package.json
├── tsconfig.json
└── README.md
```

**marketplace.json:**

```json
{
  "name": "excaliclaude-marketplace",
  "owner": {
    "name": "ttessarolo",
    "email": "ttessarolo@gmail.com"
  },
  "plugins": [
    {
      "name": "excaliclaude",
      "source": ".",
      "description": "Interactive visual collaboration between human and Claude on a shared Excalidraw canvas. Draw together, discuss ideas visually, brainstorm on a whiteboard.",
      "version": "0.1.0",
      "author": {
        "name": "ttessarolo"
      },
      "homepage": "https://github.com/ttessarolo/excaliclaude",
      "repository": "https://github.com/ttessarolo/excaliclaude",
      "license": "MIT",
      "keywords": [
        "excalidraw", "canvas", "visual-collaboration",
        "diagram", "architecture", "brainstorm", "whiteboard"
      ],
      "category": "productivity"
    }
  ]
}
```

#### Opzione B — Marketplace ufficiale Anthropic

Dopo che il plugin è stabile (v1.0+), puoi sottoporlo al marketplace
ufficiale tramite:
- https://claude.ai/settings/plugins/submit
- https://platform.claude.com/plugins/submit

Se accettato, gli utenti lo vedranno nel tab **Discover** di `/plugin`
e potranno installarlo con:
```
/plugin install excaliclaude@claude-plugins-official
```

#### Opzione C — npm package

Alternativa per distribuzione via npm registry:

```json
// In marketplace.json, il source diventa:
{
  "name": "excaliclaude",
  "source": {
    "source": "npm",
    "package": "@ttessarolo/excaliclaude",
    "version": "^0.1.0"
  }
}
```

Richiede pubblicare il pacchetto su npm con `npm publish`.

### 7.2 La Questione della Build

Claude Code, quando installa un plugin, **copia la directory del plugin
in una cache locale** (`~/.claude/plugins/cache/`). Questo significa che:

1. Il plugin deve essere **self-contained** — tutto ciò che serve deve
   essere dentro la directory
2. Le dipendenze npm devono essere incluse o installabili

**Due strategie per gestire la build:**

**Strategia A — Build pre-compilata nel repo (CONSIGLIATA per MVP):**

Committa la cartella `dist/` nel repo. Più semplice, funziona subito.

```json
// .mcp.json
{
  "mcpServers": {
    "excaliclaude": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/index.js"],
      "env": {
        "CANVAS_APP_PATH": "${CLAUDE_PLUGIN_ROOT}/dist/canvas-app/start.js"
      }
    }
  }
}
```

Pro: Zero build step per l'utente. Funziona immediatamente.
Contro: `dist/` nel repo, file compilati nel git history.

**Strategia B — Post-install hook con build:**

Usa un hook `SessionStart` per buildare alla prima esecuzione:

```json
// hooks/hooks.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "cd ${CLAUDE_PLUGIN_ROOT} && [ -d dist ] || (npm install && npm run build)"
        }]
      }
    ]
  }
}
```

Pro: Repo pulito, solo sorgenti.
Contro: Prima esecuzione lenta, richiede Node.js + npm sull'host.

**Strategia C — GitHub Action che builda e crea release:**

La migliore per distribuzione seria. La GitHub Action:
1. Builda il TypeScript
2. Builda il frontend Vite
3. Installa le dipendenze di produzione
4. Committa tutto in un branch `dist` o crea un release artifact

```yaml
# .github/workflows/build.yml
name: Build ExcaliClaude

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build MCP server
        run: bun run build:mcp

      - name: Build Canvas App
        run: bun run build:canvas

      - name: Prune dev dependencies
        run: bun install --production

      - name: Create release artifact
        run: |
          # Crea un pacchetto con solo ciò che serve al runtime
          mkdir -p release/excaliclaude
          cp -r .claude-plugin release/excaliclaude/
          cp -r skills release/excaliclaude/
          cp -r dist release/excaliclaude/
          cp .mcp.json release/excaliclaude/
          cp package.json release/excaliclaude/
          cp -r node_modules release/excaliclaude/
          cd release && zip -r ../excaliclaude-${{ github.ref_name }}.zip excaliclaude/

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: excaliclaude-${{ github.ref_name }}.zip

      # Aggiorna il branch 'release' con la build
      - name: Push to release branch
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@github.com"
          git checkout -B release
          git add -f dist/ node_modules/
          git commit -m "Build ${{ github.ref_name }}"
          git push origin release --force
```

Con questa strategia, il `marketplace.json` punta al branch `release`:

```json
{
  "name": "excaliclaude",
  "source": {
    "source": "github",
    "repo": "ttessarolo/excaliclaude",
    "ref": "release"
  }
}
```

**Raccomandazione:** Inizia con **Strategia A** (dist nel repo) per il
MVP, poi migra a **Strategia C** (GitHub Action) quando il progetto
è stabile.

### 7.3 Come un Utente Installa ExcaliClaude

**Prerequisiti utente:**
- Claude Code installato e autenticato
- Node.js 18+ (per il MCP server)
- Un browser (Chrome/Firefox/Safari — per il canvas)

**Installazione (3 comandi):**

```bash
# 1. Aggiungi il marketplace (una volta sola)
/plugin marketplace add ttessarolo/excaliclaude

# 2. Installa il plugin
/plugin install excaliclaude@excaliclaude-marketplace

# 3. Ricarica (se già in una sessione)
/reload-plugins
```

**Oppure**, per test rapido senza marketplace:

```bash
# Clona e usa direttamente
git clone https://github.com/ttessarolo/excaliclaude.git
cd excaliclaude && npm install && npm run build
claude --plugin-dir ./excaliclaude
```

**Primo utilizzo:**

L'utente scrive semplicemente in Claude Code:
```
"Apri un canvas, voglio discutere di un'idea"
```

La skill ExcaliClaude si attiva, Claude invoca `open_canvas`, il
browser si apre con Excalidraw + Claude Sidebar, e la sessione inizia.

### 7.4 Dipendenze Runtime e Apertura Finestra

Il plugin usa un sistema a **3 livelli di fallback** per aprire la finestra
del canvas. L'utente NON ha bisogno di un browser — il sistema usa la
webview nativa dell'OS quando possibile.

**Come si apre la finestra (in ordine di priorità):**

| Livello | Tecnologia | Risultato | Requisito |
|---------|-----------|-----------|-----------|
| 1 (best) | **webview-bun** | Finestra nativa OS | `webview-bun` installato + dipendenze OS |
| 2 | **Chrome/Edge app-mode** | Finestra senza chrome | Chrome, Edge, o Brave installato |
| 3 | **Browser di default** | Tab nel browser | Qualsiasi browser |

**Dipendenze runtime:**

| Dipendenza | Perché | Note |
|-----------|--------|------|
| **Node.js 18+** | Runtime MCP server | Già presente con Claude Code |
| **Bun** (raccomandato) | Runtime canvas server + webview | `curl -fsSL https://bun.sh/install \| bash` |
| **webview-bun** | Finestra nativa | Installato automaticamente come dipendenza del plugin |

**Dipendenze OS per webview nativa (Livello 1):**
- **macOS**: Nessuna — WebKit è integrato
- **Windows**: WebView2 runtime (incluso in Windows 11, installabile su 10)
- **Linux**: `libgtk-4-dev` + `libwebkitgtk-6.0-dev`

Se le dipendenze OS non sono presenti, il sistema fa fallback silenzioso
al Livello 2 (Chrome app-mode) senza errori per l'utente.

Se Bun non è disponibile, il canvas server funziona anche con Node.js.
Il `SessionManager` fa detect automatico:

```typescript
// In session-manager.ts
private getRuntime(): string {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return "bun";
  } catch {
    return "node";
  }
}
```

### 7.5 Aggiornamenti

Con il marketplace configurato, gli utenti ricevono aggiornamenti
automaticamente se hanno `auto-update` abilitato (default per marketplace
non-ufficiali: disabilitato). L'utente può:

```bash
# Aggiornamento manuale del marketplace
/plugin marketplace update excaliclaude-marketplace

# Oppure forzare il reload
/reload-plugins
```

Per pubblicare un aggiornamento:
1. Incrementa `version` in `plugin.json` e `marketplace.json`
2. Builda e committa/tagga
3. Se usi GitHub Action: tagga con `git tag v0.2.0 && git push --tags`
4. Gli utenti ricevono l'update al prossimo refresh

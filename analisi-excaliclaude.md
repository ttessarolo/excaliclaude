# ExcaliClaude — Analisi di Fattibilità (v2)

## 1. Visione del Progetto

L'obiettivo è creare un'estensione (plugin/skill) per **Claude Code** che abiliti una **sessione interattiva bidirezionale** tra umano e Claude attraverso un canvas Excalidraw. A differenza della maggior parte dei progetti esistenti, qui l'interazione non è unidirezionale (Claude genera → umano guarda) ma è un vero **dialogo visivo** dove entrambi disegnano, commentano e iterano sullo stesso canvas in tempo reale.

---

## 2. Panorama dell'Ecosistema Esistente

La ricerca ha rivelato un ecosistema molto più ricco del previsto. Ci sono almeno **10 progetti rilevanti**, classificabili in 3 categorie.

### Categoria A — Generatori One-Shot (Claude → file, nessun canvas live)

| Repo | Cosa fa | Utilità |
|------|---------|---------|
| **ooiyeefei/ccc** | Skill che analizza codebase e genera JSON Excalidraw. Ottima conoscenza dello schema v2 (binding, arrow routing, colori per tipo). | ⭐⭐⭐ Reference per JSON |
| **coleam00/excalidraw-diagram-skill** | Converte NL in file .excalidraw, valida con Playwright/PNG. Focus su diagrammi "belli", non boxes-and-arrows. | ⭐⭐ Rendering pipeline |
| **rnjn/cc-excalidraw-skill** | Skill base per Claude Code, genera .excalidraw da prompt. | ⭐ Minimale |

Questi progetti non hanno canvas live né interattività. Utili solo come reference per la generazione JSON.

### Categoria B — Canvas Live Unidirezionale (Claude → canvas, umano guarda)

| Repo | Cosa fa | Utilità |
|------|---------|---------|
| **edwingao28/excalidraw-skill** | 3-layer: Skill + MCP Server + Express Canvas Server (porta 3000). Claude piazza shape/frecce via MCP tool. Auto-validazione via screenshot. CLI setup/teardown. | ⭐⭐⭐⭐ Infrastruttura |
| **edwingao28/excalidraw-toolkit** | Evoluzione del precedente: pipeline 6 fasi, auto-critique geometrica + screenshot, conversione Mermaid, rollback via snapshot. | ⭐⭐⭐⭐ Più maturo |
| **excalidraw/excalidraw-mcp** | **MCP ufficiale di Excalidraw.** Streaming SVG con morphdom, fullscreen editing, checkpoint persistence (Redis/localStorage). React 19, Bun, Excalidraw 0.18. Pensato per Claude Desktop/web (MCP Apps inline nel chat), **non per Claude Code CLI.** | ⭐⭐⭐ Pattern MCP App |
| **antonpk1/excalidraw-mcp-app** | Fork/variante dell'MCP ufficiale. Aggiunge checkpoint save/read, camera animations. No WebSocket — usa MCP event handlers. | ⭐⭐ Checkpoint pattern |

Questi hanno un canvas live ma l'umano non può disegnare e Claude non vede modifiche umane.

### Categoria C — Bidirezionalità (parziale o completa)

| Repo | Cosa fa | Bidirezionalità | Utilità |
|------|---------|:---:|---------|
| **yctimlin/mcp_excalidraw** | **26 MCP tools!** CRUD elementi, layout, alignment, group, import/export, screenshot, describe_scene, snapshot/restore. Express + WebSocket bidirezionale. Umano disegna → broadcast WS → Claude legge via screenshot/describe_scene. **Funziona con Claude Code.** | ✅ PIENA | ⭐⭐⭐⭐⭐ |
| **lesleslie/excalidraw-mcp** | Dual-language: Python FastMCP backend + TypeScript Express canvas. WebSocket bidirezionale, version/timestamp su elementi, circuit breaker. | ✅ PIENA | ⭐⭐⭐⭐ |
| **WHQ25/agent-canvas** | Skill per Claude Code. CLI → WebSocket → Excalidraw (porta 5173). Umano può editare, agente esporta e analizza. Bun + Turborepo. | ✅ Parziale | ⭐⭐⭐⭐ |
| **uditalias/claude-canvas** | WebSocket bidirezionale, ask/answer pattern, sessioni. MA usa Fabric.js, non Excalidraw. DSL proprietario. | ✅ PIENA (no Excalidraw) | ⭐⭐⭐ Pattern |

---

## 3. Deep-Dive sui Candidati Migliori

### 3.1 ⭐ yctimlin/mcp_excalidraw — IL PROGETTO PIÙ VICINO

Questo è di gran lunga il progetto più completo e più vicino ai nostri requisiti.

**Architettura:**
- Frontend: React + Vite + Excalidraw 0.18 (porta 3000)
- Backend: Node.js + Express + TypeScript + ws (WebSocket)
- MCP: SDK stdio, 26 tool esposti
- Funziona con: Claude Code, Claude Desktop, Cursor, Codex CLI

**26 MCP Tools:**
- Element CRUD (7): `create_element`, `update_element`, `delete_element`, `get_element`, `batch_create_elements`, `duplicate_elements`, `query_elements`
- Layout (4): `align_elements`, `distribute_elements`, `group_elements`, `ungroup_elements`
- Canvas control (3): `clear_canvas`, `lock_elements`, `unlock_elements`
- Import/Export (5): `export_scene` (JSON), `import_scene`, `export_to_image` (PNG/SVG), `export_to_excalidraw_url`, `create_from_mermaid`
- Inspection (4): `describe_scene` (testo), `get_canvas_screenshot` (PNG), `snapshot_scene`, `restore_snapshot`
- State/Guidance (2): `read_diagram_guide`, `set_viewport`
- Manca: `open_blank_canvas`, `ask_on_canvas`, `save_session`

**Bidirezionalità:**
- ✅ Claude → Canvas: tool MCP → REST API → WebSocket broadcast → React render
- ✅ Umano → Claude: umano disegna in Excalidraw UI → WebSocket broadcast → Claude legge via `get_canvas_screenshot` o `describe_scene`
- ⚠️ Non c'è un meccanismo di "notifica attiva" verso Claude quando l'umano modifica il canvas — Claude deve fare polling esplicito

**Cosa manca rispetto a ExcaliClaude:**
- ❌ Nessun concetto di "sessione interattiva" con turn-taking
- ❌ L'umano non può segnalare "ho finito, guarda" (pulsante UI → notifica MCP)
- ❌ Nessun tool `open_canvas` per iniziare una sessione blank su richiesta umana
- ❌ Persistenza in-memory only (restart = perdita dati)
- ❌ Non c'è una Skill SKILL.md che guidi Claude nell'interazione collaborativa
- ❌ Manca il concetto di "commentare" sul canvas (annotazioni Claude vs umano con colori diversi)

### 3.2 lesleslie/excalidraw-mcp — Architettura Alternativa Interessante

**Dual-language:** Python (FastMCP + Pydantic) per il backend MCP + TypeScript (Express + ws) per il canvas server. Approccio più enterprise con version/timestamp su ogni elemento e circuit breaker.

**Vantaggi rispetto a yctimlin:**
- Gestione conflitti via versioning
- Testing più robusto (pytest 85%, Jest 70%)
- Circuit breaker per resilienza

**Svantaggi:**
- Dipendenza Python aggiuntiva (uvx)
- Meno tool esposti
- Community più piccola

### 3.3 WHQ25/agent-canvas — Excalidraw via Skill

**Approccio diverso:** Non è un MCP server ma una skill installabile (`npx skills add`). CLI manda comandi via WebSocket a Excalidraw. Bun + Turborepo monorepo.

**Interessante perché:** Dimostra che si può avere un canvas Excalidraw bidirezionale anche come skill pura (senza MCP), riducendo la complessità di setup.

---

## 4. Matrice Gap Aggiornata

| Requisito | yctimlin | lesleslie | agent-canvas | excalidraw-mcp (ufficiale) |
|-----------|:---:|:---:|:---:|:---:|
| Canvas Excalidraw live | ✅ | ✅ | ✅ | ✅ (inline) |
| Claude disegna | ✅ (26 tools) | ✅ | ✅ (CLI) | ✅ (streaming) |
| Umano disegna | ✅ | ✅ | ✅ | ✅ (fullscreen) |
| Claude vede disegni umano | ✅ (screenshot) | ✅ (WS) | ⚠️ (export) | ⚠️ (checkpoint) |
| Sessione interattiva turn-based | ❌ | ❌ | ❌ | ❌ |
| Umano inizia canvas vuoto | ❌ | ❌ | ❌ | ❌ |
| Notifica attiva umano→Claude | ❌ | ❌ | ❌ | ❌ |
| Formato .excalidraw nativo | ✅ | ✅ | ✅ | ✅ |
| MCP Server | ✅ | ✅ | ❌ (skill) | ✅ (MCP App) |
| Claude Code compatibile | ✅ | ✅ | ✅ | ❌ (Desktop) |
| Persistenza sessione | ❌ (memory) | ❌ (memory) | ❌ | ⚠️ (checkpoint) |
| Salvataggio .excalidraw file | ✅ (export) | ❌ | ❌ | ✅ (export URL) |

**Il gap residuo** si concentra su 3 feature che NESSUN progetto ha:
1. **Sessione interattiva turn-based** con notifica attiva umano → Claude
2. **Apertura canvas vuoto su richiesta dell'umano**
3. **Persistenza sessione** con salvataggio automatico .excalidraw

---

## 5. Rivalutazione Strategica: Build vs Fork

### Opzione 1: Fork di yctimlin/mcp_excalidraw (RACCOMANDATO)

**Pro:**
- 26 tool MCP già funzionanti e testati
- WebSocket bidirezionale già implementato
- Funziona già con Claude Code
- Aggiungere le 3 feature mancanti è un delta gestibile

**Da aggiungere:**
1. **Tool `open_canvas`** — crea sessione, avvia server se necessario, apre browser
2. **Notifica UI** — pulsante "Claude, guarda!" nel frontend Excalidraw che manda un evento WebSocket. Il MCP server lo espone come tool `wait_for_human_signal` (blocking fino a evento)
3. **Tool `save_session`** — serializza stato canvas in file .excalidraw nella cartella progetto
4. **Skill SKILL.md** — istruzioni per Claude su come gestire la sessione collaborativa
5. **Differenziazione visiva** — elementi creati da Claude in un colore/stile, quelli umani in un altro
6. **Persistenza sessione** — salvare/ripristinare lo stato da file

**Effort stimato:** 1-2 settimane per un MVP funzionante.

### Opzione 2: Build from Scratch

**Pro:** Architettura 100% su misura
**Contro:** Riscrivere 26 tool MCP, WebSocket, canvas server — almeno 4-6 settimane

### Opzione 3: Composizione di più repo

**Pro:** Best of each
**Contro:** Debito tecnico da integrazioni multiple, stili di codice diversi

---

## 6. Architettura Proposta (Aggiornata)

Partendo dal fork di **yctimlin/mcp_excalidraw**, aggiungiamo un "Session Layer":

```
┌──────────────────────────────────────────────────────────┐
│                     CLAUDE (LLM)                          │
│  Skill ExcaliClaude (SKILL.md)                           │
│  Guida Claude su quando aprire canvas, come collaborare,  │
│  quando salvare, come interpretare disegni umani          │
└──────────┬───────────────────────────────────────────────┘
           │ MCP Protocol (stdio)
           ▼
┌──────────────────────────────────────────────────────────┐
│           MCP Server (fork yctimlin + estensioni)         │
│                                                           │
│  Tool esistenti (26):                                     │
│  create/update/delete/get/batch/duplicate/query_elements  │
│  align/distribute/group/ungroup_elements                  │
│  export_scene/import_scene/export_to_image                │
│  describe_scene/get_canvas_screenshot/snapshot/restore    │
│  clear_canvas/lock/unlock/set_viewport/read_guide         │
│  create_from_mermaid/export_to_excalidraw_url             │
│                                                           │
│  NUOVI Tool sessione:                                     │
│  • open_canvas({title, blank?, session_id?})              │
│  • wait_for_human_signal() → blocking, ritorna stato      │
│  • save_session({path, format: "excalidraw"|"png"})       │
│  • load_session({path})                                   │
│  • annotate({text, position, style: "claude"})            │
│  • get_session_history() → cronologia modifiche           │
└──────────┬───────────────────────────────────────────────┘
           │ WebSocket (bidirezionale)
           ▼
┌──────────────────────────────────────────────────────────┐
│        Canvas Server (Express + Excalidraw React)         │
│                                                           │
│  Esistente:                                               │
│  • Excalidraw canvas con manipolazione programmatica      │
│  • REST API per CRUD elementi                             │
│  • WebSocket broadcast per sync                           │
│                                                           │
│  NUOVI componenti UI:                                     │
│  • 🔔 Barra di stato sessione (chi sta disegnando)        │
│  • ✋ Pulsante "Claude, guarda!" → emette WS event         │
│  • 🎨 Indicatore visivo elementi Claude vs Umano           │
│  • 💾 Auto-save periodico dello stato sessione             │
│  • 📋 Pannello laterale con messaggi Claude (opzionale)    │
└──────────────────────────────────────────────────────────┘
```

---

## 7. Valutazione di Fattibilità (Aggiornata)

### Fattibilità Tecnica: ✅ MOLTO ALTA

La scoperta di yctimlin/mcp_excalidraw cambia radicalmente la valutazione. L'80% dell'infrastruttura è già costruita e funzionante. Il delta è un "session layer" sopra un sistema già bidirezionale.

### Complessità: ⚠️ MEDIA (ridotta rispetto alla v1 dell'analisi)

Le sfide restanti:
- **Design del `wait_for_human_signal`**: Come implementare un tool MCP blocking che aspetta un evento dal browser? Approccio: long-polling HTTP o WebSocket event → Promise resolve nel MCP handler.
- **Token cost**: `describe_scene` aiuta (testo compatto vs JSON completo), ma per canvas complessi serve un budget strategy.
- **Differenziazione visiva**: Excalidraw non ha nativamente il concetto di "autore" per elemento. Si può usare un metadata custom o uno schema di colori.

### Timeline (rivista):

| Fase | Durata | Descrizione |
|------|--------|-------------|
| **MVP** | 1 settimana | Fork yctimlin + `open_canvas` + `save_session` + Skill SKILL.md base |
| **v0.2** | 1 settimana | `wait_for_human_signal` + UI pulsante + differenziazione visiva |
| **v0.3** | 1 settimana | Persistenza sessioni, load/save, session history |
| **v1.0** | 1 settimana | Polish, packaging come plugin, documentazione, edge cases |

**Total: ~4 settimane** per una v1.0 completa (vs 7-9 settimane della stima precedente).

---

## 8. Raccomandazioni (Aggiornate)

1. **Forkare yctimlin/mcp_excalidraw** come base. Ha già 26 tool MCP, WebSocket bidirezionale, e funziona con Claude Code. È il 80% del lavoro.

2. **Concentrare lo sviluppo sul "Session Layer"**: i 3 gap chiave (open_canvas, wait_for_human_signal, save_session) che trasformano un tool di disegno in una piattaforma di collaborazione.

3. **Scrivere una Skill SKILL.md robusta** che insegni a Claude *come* collaborare visivamente — non solo quali tool usare, ma il protocollo di interazione (aprire canvas → aspettare input umano → analizzare → rispondere → iterare → salvare).

4. **Usare `describe_scene` come canale primario** per la "visione" di Claude (più economico in token di screenshot), con screenshot come fallback per layout complessi.

5. **Implementare `wait_for_human_signal` come tool MCP blocking** — è il pezzo tecnico più critico e innovativo. Pattern: il tool avvia un long-poll/WebSocket listener, il frontend manda un evento quando l'umano clicca "guarda", il tool risolve e ritorna lo stato attuale del canvas.

6. **Taggare ogni elemento con metadata `author`** (claude/human) per la differenziazione visiva e per aiutare Claude a capire cosa ha disegnato l'umano vs cosa ha disegnato lui.

7. **Packaging come plugin Claude Code** con: `.mcp.json` per il server, `skills/excaliclaude/SKILL.md` per la skill, `bin/` per il canvas server. Installazione one-command.

8. **Considerare anche lesleslie/excalidraw-mcp** come alternativa — l'approccio dual-language e il version/timestamp sugli elementi potrebbe essere utile per gestire i conflitti nella collaborazione.

---

## Appendice: Fonti

### Repository Analizzati

- [ooiyeefei/ccc — Excalidraw Skill](https://github.com/ooiyeefei/ccc/tree/main/skills/excalidraw)
- [edwingao28/excalidraw-skill](https://github.com/edwingao28/excalidraw-skill)
- [uditalias/claude-canvas](https://github.com/uditalias/claude-canvas)
- [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw) ⭐ Base raccomandata
- [excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) (MCP ufficiale)
- [lesleslie/excalidraw-mcp](https://github.com/lesleslie/excalidraw-mcp)
- [WHQ25/agent-canvas](https://github.com/WHQ25/agent-canvas)
- [antonpk1/excalidraw-mcp-app](https://github.com/antonpk1/excalidraw-mcp-app)
- [edwingao28/excalidraw-toolkit](https://github.com/edwingao28/excalidraw-toolkit)
- [coleam00/excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill)

### Issue/Discussion Excalidraw Ufficiali

- [Issue #9736 — MCP Server Integration: Real-time Claude + Excalidraw Canvas Sync](https://github.com/excalidraw/excalidraw/issues/9736)
- [Discussion #9666 — MCP?](https://github.com/excalidraw/excalidraw/discussions/9666)

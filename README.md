# ExcaliClaude

Plugin per [Claude Code](https://docs.claude.com/claude-code) che abilita
sessioni di collaborazione visiva bidirezionale **umano ↔ Claude** su un
canvas [Excalidraw](https://excalidraw.com) live.

Claude apre una finestra nativa con Excalidraw + una sidebar Claude integrata.
L'umano disegna, Claude risponde sia testualmente (nella sidebar) sia
visivamente (aggiungendo, modificando, annotando elementi sul canvas).

## Architettura

```
Claude Code CLI
     │ (MCP stdio)
     ▼
ExcaliClaude MCP Server  ──spawn──►  Canvas App (Bun/Node)
 (26 tool legacy +                   ├─ Express + WebSocket
  8 tool sessione)                   └─ Finestra nativa webview-bun
                                        (fallback: Chrome app-mode)
```

Ogni sessione è un **processo indipendente** con la sua porta e finestra
dedicata, gestito dal `SessionManager` centrale.

## Tool MCP

**26 tool legacy** ereditati dal fork di
[yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw):

- **Elementi** — `create_element`, `update_element`, `delete_element`,
  `get_element`, `batch_create_elements`, `duplicate_elements`, `query_elements`
- **Layout** — `align_elements`, `distribute_elements`, `group_elements`,
  `ungroup_elements`, `lock_elements`, `unlock_elements`
- **Export/Import** — `export_scene`, `import_scene`, `export_to_image`,
  `export_to_excalidraw_url`, `create_from_mermaid`
- **Inspect** — `describe_scene`, `get_canvas_screenshot`, `snapshot_scene`,
  `restore_snapshot`, `clear_canvas`, `set_viewport`, `read_diagram_guide`

**8 tool sessione** nuovi di ExcaliClaude:

| Tool | Descrizione |
|---|---|
| `open_canvas` | Apre un nuovo canvas in una finestra dedicata |
| `close_canvas` | Chiude una sessione, opzionalmente la salva |
| `list_sessions` | Lista le sessioni attive |
| `wait_for_human` | Blocca fino al segnale "Claude, guarda!" dell'umano |
| `save_session` | Salva lo stato come file `.excalidraw` |
| `send_message_to_canvas` | Invia un messaggio Claude alla sidebar |
| `annotate` | Commenta un elemento con nota + freccia |
| `get_human_changes` | Recupera le modifiche umane recenti |

## Installazione (sviluppo)

```bash
git clone https://github.com/ttessarolo/excaliclaude.git
cd excaliclaude
npm install
npm run build
```

Poi registra il plugin in Claude Code:

```bash
/plugin marketplace add ttessarolo/excaliclaude
/plugin install excaliclaude@excaliclaude-marketplace
```

## Utilizzo

In una conversazione con Claude Code:

> Apri un canvas, voglio discutere l'architettura del mio progetto

Claude attiverà automaticamente la skill `excaliclaude`, aprirà una finestra
con il canvas, disegnerà una prima proposta e aspetterà il tuo feedback.
Clicca **"👀 Claude, guarda!"** nella sidebar quando vuoi che Claude riveda
il canvas.

## Licenza

MIT — deriva da [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw).

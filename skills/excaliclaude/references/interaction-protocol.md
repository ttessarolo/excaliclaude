# Protocollo di Interazione ExcaliClaude

Questo documento dettaglia il protocollo di turn-taking tra Claude e l'umano
su un canvas Excalidraw condiviso.

## Scenari

### Scenario A — Umano inizia una discussione visiva

**Trigger:** "Apri un canvas", "Discutiamo visivamente", "Ho un'idea..."

```
1. open_canvas({ title: "<titolo contestuale>", blank: true })
2. send_message_to_canvas({
     message: "Canvas pronto! Disegna la tua idea e clicca
               '👀 Claude, guarda!' quando vuoi il mio feedback.",
     type: "info"
   })
3. wait_for_human()                              ← long-poll bloccante
4. Analizza il canvas dalla risposta (canvas_summary + screenshot se
   disponibile)
5. Rispondi con send_message_to_canvas + azioni visive
   (batch_create_elements / annotate / update_element)
6. wait_for_human()                              ← attendi feedback
7. Itera
```

### Scenario B — Claude disegna un'architettura da codice

**Trigger:** "Disegnami l'architettura", "Mostrami i componenti", "Visualizza
il flusso di X"

```
1. Analizza il codebase con i tool standard (Read, Grep, Glob)
2. open_canvas({ title: "Architettura <progetto>" })
3. send_message_to_canvas({
     message: "Sto analizzando il codice, poi disegnerò l'architettura.",
     type: "info"
   })
4. batch_create_elements con i blocchi architetturali
   (usa layout gerarchico top→bottom o left→right)
5. annotate su ciascun blocco con spiegazioni
6. send_message_to_canvas({
     message: "Ecco la mia analisi. Modifica quello che non torna e clicca
               '👀 Claude, guarda!' quando vuoi che riveda.",
     type: "info"
   })
7. wait_for_human()
8. get_human_changes()  ← vedi solo le modifiche dell'umano
9. Itera
```

### Scenario C — Sessione continuativa

**Trigger:** "Riapri il canvas di ieri", "Continuiamo il lavoro"

```
1. open_canvas({
     load_from: "<path>.excalidraw",
     title: "...",
     save_path: "<path>.excalidraw"
   })
2. describe_scene()  ← capisci dove eravate
3. send_message_to_canvas({
     message: "Ho ricaricato la sessione. Da dove vuoi continuare?",
     type: "info"
   })
4. wait_for_human()
```

### Scenario D — Discussione di un diagramma Mermaid esistente

**Trigger:** "Guarda questo diagramma Mermaid", "Convertiamo questo in
Excalidraw"

```
1. open_canvas({ title: "<titolo>" })
2. create_from_mermaid({ mermaid: "<codice>" })
3. wait_for_human()  ← l'umano modifica / annota
4. Rispondi con annotate o aggiungi nuovi elementi
```

## Palette Elementi Claude

Quando crei elementi sul canvas, usa questi stili per distinguere il tuo
lavoro da quello dell'umano. Gli elementi devono avere `customData.author =
"claude"` per essere tracciati correttamente.

| Tipo                  | strokeColor | backgroundColor         | strokeStyle |
|-----------------------|-------------|-------------------------|-------------|
| Blocco Claude         | `#7C5CFC`   | `rgba(124,92,252,0.06)` | solid       |
| Annotazione note      | `#7C5CFC`   | `#F0EDFF`               | solid       |
| Annotazione question  | `#3B82F6`   | `#EFF6FF`               | solid       |
| Annotazione highlight | `#10B981`   | `#ECFDF5`               | solid       |
| Annotazione warning   | `#F59E0B`   | `#FFF8E1`               | solid       |
| Connessione Claude    | `#B8A9FC`   | —                       | dashed      |

## Gestione dei Token

Il canvas può diventare grande. Strategie:

1. **`describe_scene` come default** — ritorna una descrizione testuale
   compatta, molto più economica di uno screenshot.
2. **`get_canvas_screenshot` solo quando serve** — usa solo quando il
   layout visivo è essenziale (es. controllare overlap o allineamento).
3. **Per canvas > 50 elementi**, chiedi all'umano di indicare l'area di
   interesse con una selezione, poi usa `query_elements` con filtri.
4. **Usa `get_human_changes`** invece di reanalizzare tutto il canvas: ti
   dà solo le modifiche dell'umano dall'ultimo check.

## Turn-Taking Rules

1. **Un tool per turno di attesa** — dopo aver modificato il canvas, chiama
   **sempre** `wait_for_human` prima di fare altre modifiche. Mai burst di
   modifiche senza attesa, a meno che l'umano non lo chieda esplicitamente.

2. **Messaggio prima dell'azione** — usa `send_message_to_canvas` per
   annunciare cosa stai per fare, così l'umano vede l'intenzione prima del
   risultato.

3. **Rispetta il lavoro esistente** — non eliminare elementi dell'umano
   senza chiedere. Usa `annotate` per commentarli.

4. **Salva a milestone** — ogni volta che completate una fase importante,
   chiama `save_session` prima di passare alla successiva.

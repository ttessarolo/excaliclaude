# Canvas Patterns — Pattern per diagrammi comuni

Guida pragmatica per disegnare diagrammi leggibili e coerenti sul canvas
ExcaliClaude. Ogni pattern include: quando usarlo, struttura, spacing
consigliato, ed esempio di chiamate ai tool.

> **Prima di disegnare**, chiama `read_diagram_guide` per caricare la palette
> semantica completa e i template di layout.

## Stile professionale (clean style)

Per diagrammi tecnici e architetturali, imposta su ogni elemento:
- `roughness: 0` — linee pulite, senza tratto a mano
- `fillStyle: "solid"` — riempimento pieno
- `fontFamily: 2` — Helvetica, sans-serif
- `roundness: { type: 3 }` — angoli arrotondati sui rettangoli
- `strokeWidth: 2`

Per brainstorming e mind map informali, mantieni i default (roughness 1,
fontFamily 1 Virgil).

## 1. Architettura a livelli (Layered Architecture)

**Quando:** per mostrare strati verticali (UI → Business → Data), pipeline
di elaborazione, o flow di richiesta/risposta tra servizi.

**Layout:**

- Rettangoli orizzontali lunghi, uno sopra l'altro
- Spacing verticale: 140px tra i layer (griglia 20px)
- Width uniforme (es. 600px), height 80px
- Colori semantici per tipo di layer

**Esempio di chiamata:**

```json
{
  "tool": "batch_create_elements",
  "elements": [
    { "type": "rectangle", "x": 100, "y": 100, "width": 600, "height": 80,
      "text": "Presentation Layer (React)",
      "strokeColor": "#1971c2", "backgroundColor": "#a5d8ff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "type": "rectangle", "x": 100, "y": 240, "width": 600, "height": 80,
      "text": "Business Logic (Node.js)",
      "strokeColor": "#7048e8", "backgroundColor": "#d0bfff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "type": "rectangle", "x": 100, "y": 380, "width": 600, "height": 80,
      "text": "Data Layer (PostgreSQL)",
      "strokeColor": "#2f9e44", "backgroundColor": "#b2f2bb",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } }
  ]
}
```

## 2. Grafo di dipendenze (DAG)

**Quando:** moduli interconnessi, chiamate tra microservizi, grafo di build.

**Layout:**

- Nodi come rettangoli arrotondati (`roundness: { type: 3 }`)
- Archi come `arrow` con `startElementId` / `endElementId` per il binding
- Usa algoritmo layered top-down (Sugiyama) o radiale per grafi piccoli
- Spacing orizzontale: 220px, verticale: 140px
- Colori semantici per tipo di componente

**Esempio:**

```json
{
  "tool": "batch_create_elements",
  "elements": [
    { "id": "api", "type": "rectangle", "x": 100, "y": 100,
      "width": 160, "height": 80, "text": "API Gateway",
      "strokeColor": "#7048e8", "backgroundColor": "#d0bfff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "auth", "type": "rectangle", "x": 320, "y": 100,
      "width": 160, "height": 80, "text": "Auth Service",
      "strokeColor": "#7048e8", "backgroundColor": "#d0bfff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "db", "type": "rectangle", "x": 200, "y": 240,
      "width": 160, "height": 80, "text": "PostgreSQL",
      "strokeColor": "#2f9e44", "backgroundColor": "#b2f2bb",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "api", "endElementId": "auth",
      "text": "HTTP", "roughness": 0 },
    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "api", "endElementId": "db",
      "text": "SQL", "roughness": 0 }
  ]
}
```

## 3. Flowchart decisionale

**Quando:** logica di branching, flussi if/else, state machine semplici.

**Layout:**

- Ellissi per start/end (120×60, verde start, rosso end)
- Rombi (`diamond`) per le decisioni (100×100)
- Rettangoli per le azioni (140×70)
- Frecce con label (usa `text` sull'arrow)
- Spacing verticale: 140px, colonne separate per i rami
- Tutti `roughness: 0`, `fillStyle: "solid"`, `fontFamily: 2`

## 4. Sequence diagram (bande verticali)

**Quando:** protocolli di comunicazione, chiamate sync/async tra attori.

**Layout:**

- Rettangoli "lifeline" in alto, uno per attore, spacing orizzontale 220px
- Linee verticali tratteggiate sotto ciascun lifeline
- Frecce orizzontali tra lifeline per i messaggi, con label
- Tempo va dall'alto in basso
- `roughness: 0`, `fontFamily: 2`

## 5. Mind map

**Quando:** brainstorming, esplorazione di un'idea.

**Layout:**

- Nodo centrale, rami che si aprono radialmente
- Distanza radiale incrementale: 150px, 250px, 350px
- Usa `text` element invece di rettangoli per look più leggero
- Linee curve (arrow non-dashed)
- Mantieni `roughness: 1`, `fontFamily: 1` — stile informale

## 6. Annotazioni Claude

Usa il tool `annotate` invece di creare manualmente rettangolo + testo +
freccia. Il server calcola posizione e styling automaticamente.

```json
{
  "tool": "annotate",
  "target_element_id": "<id del rettangolo umano>",
  "text": "Questo modulo potrebbe beneficiare di un cache Redis",
  "position": "right",
  "style": "question"
}
```

Stili disponibili:
- `note` (viola Claude)     — commenti informativi
- `comment` (giallo)        — richiami, attenzione
- `highlight` (verde)       — cose ben fatte
- `question` (blu)          — domande all'umano

## 7. Microservizi con Zone

**Quando:** architettura a microservizi con raggruppamenti logici.

**Layout:** Vertical Flow con zone tratteggiate per raggruppare i servizi.

```json
{
  "tool": "batch_create_elements",
  "elements": [
    { "type": "rectangle", "x": 60, "y": 60, "width": 440, "height": 160,
      "strokeColor": "#868e96", "strokeStyle": "dashed", "strokeWidth": 1,
      "backgroundColor": "transparent", "roughness": 0 },
    { "type": "text", "x": 80, "y": 70, "text": "Frontend",
      "fontSize": 16, "fontFamily": 2 },

    { "type": "rectangle", "x": 60, "y": 280, "width": 440, "height": 300,
      "strokeColor": "#868e96", "strokeStyle": "dashed", "strokeWidth": 1,
      "backgroundColor": "transparent", "roughness": 0 },
    { "type": "text", "x": 80, "y": 290, "text": "Backend Services",
      "fontSize": 16, "fontFamily": 2 },

    { "id": "web", "type": "rectangle", "x": 100, "y": 100,
      "width": 160, "height": 80, "text": "Web App\n(React)",
      "strokeColor": "#1971c2", "backgroundColor": "#a5d8ff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "mobile", "type": "rectangle", "x": 320, "y": 100,
      "width": 160, "height": 80, "text": "Mobile App\n(React Native)",
      "strokeColor": "#1971c2", "backgroundColor": "#a5d8ff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },

    { "id": "gateway", "type": "rectangle", "x": 200, "y": 320,
      "width": 160, "height": 80, "text": "API Gateway",
      "strokeColor": "#495057", "backgroundColor": "#dee2e6",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "users-svc", "type": "rectangle", "x": 100, "y": 460,
      "width": 160, "height": 80, "text": "Users Service",
      "strokeColor": "#7048e8", "backgroundColor": "#d0bfff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "orders-svc", "type": "rectangle", "x": 320, "y": 460,
      "width": 160, "height": 80, "text": "Orders Service",
      "strokeColor": "#7048e8", "backgroundColor": "#d0bfff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },

    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "web", "endElementId": "gateway",
      "text": "HTTP", "roughness": 0 },
    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "mobile", "endElementId": "gateway",
      "text": "HTTP", "roughness": 0 },
    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "gateway", "endElementId": "users-svc",
      "text": "gRPC", "roughness": 0 },
    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "gateway", "endElementId": "orders-svc",
      "text": "gRPC", "roughness": 0 }
  ]
}
```

## 8. Pipeline Dati Orizzontale

**Quando:** flussi ETL, pipeline di elaborazione dati, CI/CD.

**Layout:** Horizontal Flow — stadi da sinistra a destra, stessa baseline y.

```json
{
  "tool": "batch_create_elements",
  "elements": [
    { "id": "source", "type": "rectangle", "x": 100, "y": 200,
      "width": 160, "height": 80, "text": "Data Source\n(S3 Bucket)",
      "strokeColor": "#e03131", "backgroundColor": "#ffc9c9",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "transform", "type": "rectangle", "x": 360, "y": 200,
      "width": 160, "height": 80, "text": "Transform\n(Spark)",
      "strokeColor": "#7048e8", "backgroundColor": "#d0bfff",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "enrich", "type": "rectangle", "x": 620, "y": 200,
      "width": 160, "height": 80, "text": "Enrich\n(ML Model)",
      "strokeColor": "#9c36b5", "backgroundColor": "#e599f7",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },
    { "id": "sink", "type": "rectangle", "x": 880, "y": 200,
      "width": 160, "height": 80, "text": "Data Warehouse\n(BigQuery)",
      "strokeColor": "#2f9e44", "backgroundColor": "#b2f2bb",
      "roughness": 0, "fillStyle": "solid", "fontFamily": 2,
      "roundness": { "type": 3 } },

    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "source", "endElementId": "transform",
      "text": "JSON", "roughness": 0 },
    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "transform", "endElementId": "enrich",
      "text": "Parquet", "roughness": 0 },
    { "type": "arrow", "x": 0, "y": 0,
      "startElementId": "enrich", "endElementId": "sink",
      "text": "Enriched", "roughness": 0 }
  ]
}
```

## Regole di spacing universali

- **Padding interno** ai rettangoli con testo: 12px
- **Spacing tra elementi correlati**: 40–60px
- **Spacing tra gruppi**: 120–200px
- **Margine dal bordo canvas**: ≥ 50px
- **Font size standard**: 14–16px
- **Font size titoli**: 20–24px
- **Font size annotazioni**: 12px

## Stile professionale (quick reference)

Per diagrammi tecnici, su ogni elemento:
- `roughness: 0`, `fillStyle: "solid"`, `fontFamily: 2`, `roundness: { type: 3 }`
- Colori semantici: scegli fill/stroke dalla tabella in `read_diagram_guide`
  in base al tipo di componente (Frontend=blu, Backend=viola, DB=verde, ecc.)

## Griglia implicita

Per diagrammi > 10 elementi, tieni una griglia a step di 20px. Quasi tutte
le coordinate dovrebbero essere multipli di 20 — questo dà un look "pulito"
che l'occhio apprezza senza capirlo.

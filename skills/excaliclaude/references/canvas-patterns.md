# Canvas Patterns — Pattern per diagrammi comuni

Guida pragmatica per disegnare diagrammi leggibili e coerenti sul canvas
ExcaliClaude. Ogni pattern include: quando usarlo, struttura, spacing
consigliato, ed esempio di chiamate ai tool.

## 1. Architettura a livelli (Layered Architecture)

**Quando:** per mostrare strati verticali (UI → Business → Data), pipeline
di elaborazione, o flow di richiesta/risposta tra servizi.

**Layout:**

- Rettangoli orizzontali lunghi, uno sopra l'altro
- Spacing verticale: 80px tra i layer
- Width uniforme (es. 600px), height 80–100px
- Etichetta a sinistra, contenuto al centro

**Esempio di chiamata:**

```json
{
  "tool": "batch_create_elements",
  "elements": [
    { "type": "rectangle", "x": 100, "y": 100, "width": 600, "height": 80,
      "text": "Presentation Layer (React)", "strokeColor": "#7C5CFC" },
    { "type": "rectangle", "x": 100, "y": 220, "width": 600, "height": 80,
      "text": "Business Logic (Node.js)", "strokeColor": "#7C5CFC" },
    { "type": "rectangle", "x": 100, "y": 340, "width": 600, "height": 80,
      "text": "Data Layer (PostgreSQL)", "strokeColor": "#7C5CFC" }
  ]
}
```

## 2. Grafo di dipendenze (DAG)

**Quando:** moduli interconnessi, chiamate tra microservizi, grafo di build.

**Layout:**

- Nodi come rettangoli arrotondati (`roundness: { type: 3 }`)
- Archi come `arrow` con `start.id` / `end.id` per il binding automatico
- Usa algoritmo layered top-down (Sugiyama) o radiale per grafi piccoli
- Spacing orizzontale: 200px, verticale: 120px

**Esempio:**

```json
{
  "tool": "batch_create_elements",
  "elements": [
    { "id": "api", "type": "rectangle", "x": 100, "y": 100, "width": 140, "height": 60, "text": "API" },
    { "id": "auth", "type": "rectangle", "x": 300, "y": 100, "width": 140, "height": 60, "text": "Auth" },
    { "id": "db", "type": "rectangle", "x": 200, "y": 220, "width": 140, "height": 60, "text": "DB" },
    { "type": "arrow", "x": 0, "y": 0, "startElementId": "api", "endElementId": "auth" },
    { "type": "arrow", "x": 0, "y": 0, "startElementId": "api", "endElementId": "db" }
  ]
}
```

## 3. Flowchart decisionale

**Quando:** logica di branching, flussi if/else, state machine semplici.

**Layout:**

- Ellissi per start/end
- Rombi (`diamond`) per le decisioni
- Rettangoli per le azioni
- Frecce con label (usa `text` element accanto all'arrow)
- Colonne verticali per i rami

## 4. Sequence diagram (bande verticali)

**Quando:** protocolli di comunicazione, chiamate sync/async tra attori.

**Layout:**

- Rettangoli "lifeline" in alto, uno per attore, spacing orizzontale 200px
- Linee verticali tratteggiate sotto ciascun lifeline
- Frecce orizzontali tra lifeline per i messaggi, con label
- Tempo va dall'alto in basso

## 5. Mind map

**Quando:** brainstorming, esplorazione di un'idea.

**Layout:**

- Nodo centrale, rami che si aprono radialmente
- Distanza radiale incrementale: 150px, 250px, 350px
- Usa `text` element invece di rettangoli per look più leggero
- Linee curve (arrow non-dashed)

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

## Regole di spacing universali

- **Padding interno** ai rettangoli con testo: 12px
- **Spacing tra elementi correlati**: 40–60px
- **Spacing tra gruppi**: 120–200px
- **Margine dal bordo canvas**: ≥ 50px
- **Font size standard**: 14–16px
- **Font size titoli**: 20–24px
- **Font size annotazioni**: 12px

## Griglia implicita

Per diagrammi > 10 elementi, tieni una griglia a step di 20px. Quasi tutte
le coordinate dovrebbero essere multipli di 20 — questo dà un look "pulito"
che l'occhio apprezza senza capirlo.

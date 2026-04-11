// ExcaliClaude — Export Tools (import/export scena, immagini, mermaid)
//
// Implementazione legacy in `../index.ts`. Vedi ELEMENT_TOOL_NAMES per pattern.
//
// Tool esposti:
//  • export_scene               — Esporta lo stato come JSON .excalidraw
//  • import_scene               — Importa uno stato da JSON .excalidraw
//  • export_to_image            — Esporta il canvas come PNG/SVG
//  • export_to_excalidraw_url   — Genera un link excalidraw.com condivisibile
//  • create_from_mermaid        — Converte un diagramma Mermaid in elementi

export const EXPORT_TOOL_NAMES = [
  'export_scene',
  'import_scene',
  'export_to_image',
  'export_to_excalidraw_url',
  'create_from_mermaid',
] as const;

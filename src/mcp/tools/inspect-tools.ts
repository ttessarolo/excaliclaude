// ExcaliClaude — Inspect Tools (descrizione, screenshot, snapshot, viewport)
//
// Implementazione legacy in `../index.ts`.
//
// Tool esposti:
//  • describe_scene         — Descrizione testuale compatta del canvas
//  • get_canvas_screenshot  — Screenshot PNG del canvas corrente
//  • snapshot_scene         — Salva uno snapshot nominato (rollback)
//  • restore_snapshot       — Ripristina uno snapshot
//  • clear_canvas           — Svuota il canvas
//  • set_viewport           — Modifica zoom / scroll del viewport
//  • read_diagram_guide     — Ritorna la guida built-in sui pattern diagrammi

export const INSPECT_TOOL_NAMES = [
  'describe_scene',
  'get_canvas_screenshot',
  'snapshot_scene',
  'restore_snapshot',
  'clear_canvas',
  'set_viewport',
  'read_diagram_guide',
] as const;

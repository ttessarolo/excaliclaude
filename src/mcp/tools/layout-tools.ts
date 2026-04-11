// ExcaliClaude — Layout Tools (allineamento, gruppi, lock)
//
// Implementazione legacy in `../index.ts`. Questo modulo è il punto di
// ancoraggio per future refactoring.
//
// Tool esposti:
//  • align_elements        — Allinea elementi selezionati su un asse
//  • distribute_elements   — Distribuisce spaziatura uniforme tra elementi
//  • group_elements        — Raggruppa elementi in un gruppo logico
//  • ungroup_elements      — Scioglie un gruppo
//  • lock_elements         — Blocca elementi (non modificabili)
//  • unlock_elements       — Sblocca elementi

export const LAYOUT_TOOL_NAMES = [
  'align_elements',
  'distribute_elements',
  'group_elements',
  'ungroup_elements',
  'lock_elements',
  'unlock_elements',
] as const;

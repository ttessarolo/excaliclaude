// ExcaliClaude — Element Tools (CRUD elementi)
//
// Questi tool restano implementati in `../index.ts` come legacy switch-case
// handler per minimizzare il diff dal fork upstream (yctimlin/mcp_excalidraw).
// Questo modulo esporta solo la lista dei tool names per documentazione e
// future refactoring verso McpServer.tool().
//
// Tool esposti:
//  • create_element          — Crea un singolo elemento Excalidraw
//  • update_element          — Aggiorna un elemento esistente per id
//  • delete_element          — Elimina un elemento per id
//  • get_element             — Recupera i dati di un elemento
//  • batch_create_elements   — Crea molti elementi in un unico batch
//  • duplicate_elements      — Clona uno o più elementi con offset
//  • query_elements          — Ricerca elementi per filtro

export const ELEMENT_TOOL_NAMES = [
  'create_element',
  'update_element',
  'delete_element',
  'get_element',
  'batch_create_elements',
  'duplicate_elements',
  'query_elements',
] as const;

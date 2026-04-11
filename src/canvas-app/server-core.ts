// server-core.ts — Factory riutilizzabile per l'app canvas.
// Nessuna chiamata listen(): il caller (server.ts dev entry o canvas-bin.ts
// prod binary) decide come startare il server HTTP.

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer, Server as HttpServer } from 'http';
import path from 'path';
import fs from 'fs';
import logger from '../mcp/utils/logger.js';
import {
  elements,
  files,
  snapshots,
  generateId,
  EXCALIDRAW_ELEMENT_TYPES,
  ServerElement,
  ExcalidrawElementType,
  ExcalidrawFile,
  WebSocketMessage,
  ElementCreatedMessage,
  ElementUpdatedMessage,
  ElementDeletedMessage,
  BatchCreatedMessage,
  SyncStatusMessage,
  InitialElementsMessage,
  Snapshot,
  normalizeFontFamily
} from '../mcp/types.js';
import { z } from 'zod';
import WebSocket from 'ws';

export interface CanvasAppOptions {
  sessionId?: string;
  title?: string;
  /** Directory da cui servire static frontend (dev mode). */
  serveStaticFrom?: string;
  /** Directory da cui servire i font Excalidraw (dev mode). */
  fontsDir?: string;
  /** Handler custom per GET / (prod binary serve da embedded). */
  rootHandler?: (req: Request, res: Response, next: NextFunction) => void;
  /** Middleware finale per asset static (prod binary). */
  staticHandler?: (req: Request, res: Response, next: NextFunction) => void;
  /** Invoked on POST /api/claude/quit after the response is sent. The
   * caller owns shutdown: kill window/child, close server, process.exit. */
  onQuit?: () => void;
  /** Path to an .excalidraw file to hydrate on startup. If a sibling .md
   * file exists, its content is armed as session memory and delivered to
   * Claude on the next signal (Feature 3). */
  loadScenePath?: string;
}

export interface CanvasApp {
  app: Express;
  server: HttpServer;
  wss: WebSocketServer;
  close(): Promise<void>;
  /** Resolve tutte le long-poll `wait_for_human` pendenti con il `signal_type`
   * indicato, PRIMA di chiudere il server. Necessario perché altrimenti
   * chiudere l'HTTP server abbatte la socket del client MCP con un
   * "fetch failed" opaco (vedi canvas-bin child-exit flow). */
  flushPendingSignals(reason: 'window_closed' | 'shutdown'): number;
}

export function createCanvasApp(options: CanvasAppOptions = {}): CanvasApp {
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Session memory loaded from a sibling .md of the .excalidraw file just
// opened — consumed once on the next /api/claude/signal (Feature 3).
// Declared here (early) so the startup hydration block below can arm it.
let pendingSessionMemory: string | null = null;

// Startup scene hydration (Feature 3): if a load path was provided, read the
// .excalidraw file and populate the in-memory maps, then arm the session
// memory from the sibling .md if present.
if (options.loadScenePath) {
  try {
    const raw = fs.readFileSync(options.loadScenePath, 'utf-8');
    const scene = JSON.parse(raw);
    if (Array.isArray(scene.elements)) {
      elements.clear();
      for (const el of scene.elements as ServerElement[]) {
        if (el && el.id) elements.set(el.id, el);
      }
      logger.info(`[load] hydrated ${elements.size} elements from ${options.loadScenePath}`);
    }
    if (scene.files && typeof scene.files === 'object') {
      files.clear();
      for (const [id, f] of Object.entries(scene.files as Record<string, ExcalidrawFile>)) {
        files.set(id, f);
      }
    }
    const mdPath = options.loadScenePath.replace(/\.excalidraw$/, '.md');
    if (fs.existsSync(mdPath)) {
      pendingSessionMemory = fs.readFileSync(mdPath, 'utf-8');
      logger.info(`[load] armed session memory from ${mdPath} (${pendingSessionMemory.length} chars)`);
    }
  } catch (err) {
    logger.error(`[load] failed to hydrate from ${options.loadScenePath}: ${(err as Error).message}`);
  }
}

// Request logger (debug level → winston file). Catches every request
// before any route handler so we can trace signals end-to-end.
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/claude') || req.method !== 'GET') {
    const bodyPreview = req.method === 'POST' && req.body
      ? ` body=${JSON.stringify(req.body).slice(0, 200)}`
      : '';
    logger.debug(`[req] ${req.method} ${req.path}${bodyPreview}`);
  }
  next();
});

if (options.serveStaticFrom) {
  app.use(express.static(options.serveStaticFrom));
}
if (options.fontsDir) {
  app.use('/assets/fonts', express.static(options.fontsDir));
}

// WebSocket connections
const clients = new Set<WebSocket>();

// Broadcast to all connected clients
function broadcast(message: WebSocketMessage): void {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    } catch (err) {
      logger.warn('Failed to send to client, removing');
      clients.delete(client);
    }
  });
}

function normalizeLineBreakMarkup(text: string): string {
  return text
    .replace(/<\s*b\s*r\s*\/?\s*>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

// WebSocket connection handling
wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  logger.info('New WebSocket connection established');

  // Send current elements to new client
  const filesObj: Record<string, ExcalidrawFile> = {};
  files.forEach((f, id) => { filesObj[id] = f; });
  const initialMessage: InitialElementsMessage & { files?: Record<string, ExcalidrawFile> } = {
    type: 'initial_elements',
    elements: Array.from(elements.values()),
    ...(files.size > 0 ? { files: filesObj } : {})
  };
  ws.send(JSON.stringify(initialMessage));

  // Send sync status to new client
  const syncMessage: SyncStatusMessage = {
    type: 'sync_status',
    elementCount: elements.size,
    timestamp: new Date().toISOString()
  };
  ws.send(JSON.stringify(syncMessage));

  ws.on('close', () => {
    clients.delete(ws);
    logger.info('WebSocket connection closed');
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Schema validation
const CreateElementSchema = z.object({
  id: z.string().optional(), // Allow passing ID for MCP sync
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES) as [ExcalidrawElementType, ...ExcalidrawElementType[]]),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.string().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  label: z.object({
    text: z.string()
  }).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.union([z.string(), z.number()]).optional(),
  groupIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  roundness: z.object({ type: z.number(), value: z.number().optional() }).nullable().optional(),
  fillStyle: z.string().optional(),
  // Arrow-specific properties
  points: z.any().optional(),
  start: z.object({ id: z.string() }).optional(),
  end: z.object({ id: z.string() }).optional(),
  startArrowhead: z.string().nullable().optional(),
  endArrowhead: z.string().nullable().optional(),
  elbowed: z.boolean().optional(),
  // Arrow binding properties (preserved for Excalidraw frontend)
  startBinding: z.object({
    elementId: z.string(),
    focus: z.number().optional(),
    gap: z.number().optional(),
    fixedPoint: z.tuple([z.number(), z.number()]).nullable().optional(),
    mode: z.string().optional(),
  }).nullable().optional(),
  endBinding: z.object({
    elementId: z.string(),
    focus: z.number().optional(),
    gap: z.number().optional(),
    fixedPoint: z.tuple([z.number(), z.number()]).nullable().optional(),
    mode: z.string().optional(),
  }).nullable().optional(),
  boundElements: z.array(z.object({
    id: z.string(),
    type: z.enum(['arrow', 'text']),
  })).nullable().optional(),
  // Image-specific properties
  fileId: z.string().optional(),
  status: z.string().optional(),
  scale: z.tuple([z.number(), z.number()]).optional(),
});

const UpdateElementSchema = z.object({
  id: z.string(),
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES) as [ExcalidrawElementType, ...ExcalidrawElementType[]]).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.string().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  originalText: z.string().optional(),
  label: z.object({
    text: z.string()
  }).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.union([z.string(), z.number()]).optional(),
  groupIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  roundness: z.object({ type: z.number(), value: z.number().optional() }).nullable().optional(),
  fillStyle: z.string().optional(),
  points: z.array(z.union([
    z.tuple([z.number(), z.number()]),
    z.object({ x: z.number(), y: z.number() })
  ])).optional(),
  start: z.object({ id: z.string() }).optional(),
  end: z.object({ id: z.string() }).optional(),
  startArrowhead: z.string().nullable().optional(),
  endArrowhead: z.string().nullable().optional(),
  elbowed: z.boolean().optional(),
  // Arrow binding properties (preserved for Excalidraw frontend)
  startBinding: z.object({
    elementId: z.string(),
    focus: z.number().optional(),
    gap: z.number().optional(),
    fixedPoint: z.tuple([z.number(), z.number()]).nullable().optional(),
    mode: z.string().optional(),
  }).nullable().optional(),
  endBinding: z.object({
    elementId: z.string(),
    focus: z.number().optional(),
    gap: z.number().optional(),
    fixedPoint: z.tuple([z.number(), z.number()]).nullable().optional(),
    mode: z.string().optional(),
  }).nullable().optional(),
  boundElements: z.array(z.object({
    id: z.string(),
    type: z.enum(['arrow', 'text']),
  })).nullable().optional(),
  // Image-specific properties
  fileId: z.string().optional(),
  status: z.string().optional(),
  scale: z.tuple([z.number(), z.number()]).optional(),
});

// API Routes

// Get all elements
app.get('/api/elements', (req: Request, res: Response) => {
  try {
    const elementsArray = Array.from(elements.values());
    res.json({
      success: true,
      elements: elementsArray,
      count: elementsArray.length
    });
  } catch (error) {
    logger.error('Error fetching elements:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Create new element
app.post('/api/elements', (req: Request, res: Response) => {
  try {
    const params = CreateElementSchema.parse(req.body);
    logger.info('Creating element via API', { type: params.type });

    // Prioritize passed ID (for MCP sync), otherwise generate new ID
    const id = params.id || generateId();
    const element: ServerElement = {
      id,
      ...params,
      fontFamily: normalizeFontFamily(params.fontFamily),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };

    // Resolve arrow bindings against existing elements
    if (element.type === 'arrow' || element.type === 'line') {
      resolveArrowBindings([element]);
    }

    elements.set(id, element);

    // Broadcast to all connected clients
    const message: ElementCreatedMessage = {
      type: 'element_created',
      element: element
    };
    broadcast(message);

    res.json({
      success: true,
      element: element
    });
  } catch (error) {
    logger.error('Error creating element:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Update element
app.put('/api/elements/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = UpdateElementSchema.parse({ id, ...req.body });

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Element ID is required'
      });
    }

    const existingElement = elements.get(id);
    if (!existingElement) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }

    const updatedElement: ServerElement = {
      ...existingElement,
      ...updates,
      fontFamily: updates.fontFamily !== undefined ? normalizeFontFamily(updates.fontFamily) : existingElement.fontFamily,
      updatedAt: new Date().toISOString(),
      version: (existingElement.version || 0) + 1
    };

    // Keep Excalidraw text source in sync when clients update text via REST.
    // If originalText lags behind text, rendered wrapping/position can drift.
    const hasTextUpdate = Object.prototype.hasOwnProperty.call(req.body, 'text');
    const hasOriginalTextUpdate = Object.prototype.hasOwnProperty.call(req.body, 'originalText');
    if (updatedElement.type === EXCALIDRAW_ELEMENT_TYPES.TEXT && hasTextUpdate && !hasOriginalTextUpdate) {
      const incomingText = updates.text ?? '';
      const existingText = typeof existingElement.text === 'string' ? existingElement.text : '';
      const existingOriginalText = typeof existingElement.originalText === 'string'
        ? existingElement.originalText
        : '';
      const existingOriginalHasBr = /<\s*b\s*r\s*\/?\s*>/i.test(existingOriginalText);
      const normalizedExistingText = normalizeLineBreakMarkup(existingText);
      const normalizedExistingOriginalText = normalizeLineBreakMarkup(existingOriginalText);

      // Handle common cleanup flow: caller normalizes the rendered text value.
      // In this case, prefer normalized originalText so words aren't split by stale wraps.
      if (existingOriginalHasBr && incomingText === normalizedExistingText && normalizedExistingOriginalText) {
        updatedElement.text = normalizedExistingOriginalText;
        updatedElement.originalText = normalizedExistingOriginalText;
      } else {
        updatedElement.originalText = incomingText;
      }
    }

    elements.set(id, updatedElement);

    // Broadcast to all connected clients
    const message: ElementUpdatedMessage = {
      type: 'element_updated',
      element: updatedElement
    };
    broadcast(message);

    res.json({
      success: true,
      element: updatedElement
    });
  } catch (error) {
    logger.error('Error updating element:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Clear all elements (must be before /:id route)
app.delete('/api/elements/clear', (req: Request, res: Response) => {
  try {
    const count = elements.size;
    elements.clear();

    broadcast({
      type: 'canvas_cleared',
      timestamp: new Date().toISOString()
    });

    logger.info(`Canvas cleared: ${count} elements removed`);

    res.json({
      success: true,
      message: `Cleared ${count} elements`,
      count
    });
  } catch (error) {
    logger.error('Error clearing canvas:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Delete element
app.delete('/api/elements/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Element ID is required'
      });
    }

    if (!elements.has(id)) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }

    elements.delete(id);

    // Broadcast to all connected clients
    const message: ElementDeletedMessage = {
      type: 'element_deleted',
      elementId: id!
    };
    broadcast(message);

    res.json({
      success: true,
      message: `Element ${id} deleted successfully`
    });
  } catch (error) {
    logger.error('Error deleting element:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Query elements with filters
app.get('/api/elements/search', (req: Request, res: Response) => {
  try {
    const { type, ...filters } = req.query;
    let results = Array.from(elements.values());

    // Filter by type if specified
    if (type && typeof type === 'string') {
      results = results.filter(element => element.type === type);
    }

    // Apply additional filters
    if (Object.keys(filters).length > 0) {
      results = results.filter(element => {
        return Object.entries(filters).every(([key, value]) => {
          return (element as any)[key] === value;
        });
      });
    }

    res.json({
      success: true,
      elements: results,
      count: results.length
    });
  } catch (error) {
    logger.error('Error querying elements:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Get element by ID
app.get('/api/elements/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Element ID is required'
      });
    }

    const element = elements.get(id);

    if (!element) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }

    res.json({
      success: true,
      element: element
    });
  } catch (error) {
    logger.error('Error fetching element:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Helper: compute edge point for an element given a direction toward a target
function computeEdgePoint(
  el: ServerElement,
  targetCenterX: number,
  targetCenterY: number
): { x: number; y: number } {
  const cx = el.x + (el.width || 0) / 2;
  const cy = el.y + (el.height || 0) / 2;
  const dx = targetCenterX - cx;
  const dy = targetCenterY - cy;

  if (el.type === 'diamond') {
    // Diamond edge: use diamond geometry (rotated square)
    const hw = (el.width || 0) / 2;
    const hh = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // Scale factor to reach diamond edge
    const scale = (absDx / hw + absDy / hh) > 0
      ? 1 / (absDx / hw + absDy / hh)
      : 1;
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  if (el.type === 'ellipse') {
    // Ellipse edge: parametric intersection
    const a = (el.width || 0) / 2;
    const b = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + b };
    const angle = Math.atan2(dy, dx);
    return { x: cx + a * Math.cos(angle), y: cy + b * Math.sin(angle) };
  }

  // Rectangle: find intersection with edges
  const hw = (el.width || 0) / 2;
  const hh = (el.height || 0) / 2;
  if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
  const angle = Math.atan2(dy, dx);
  const tanA = Math.tan(angle);
  // Check if ray intersects top/bottom edge or left/right edge
  if (Math.abs(tanA * hw) <= hh) {
    // Intersects left or right edge
    const signX = dx >= 0 ? 1 : -1;
    return { x: cx + signX * hw, y: cy + signX * hw * tanA };
  } else {
    // Intersects top or bottom edge
    const signY = dy >= 0 ? 1 : -1;
    return { x: cx + signY * hh / tanA, y: cy + signY * hh };
  }
}

// Helper: resolve arrow bindings in a batch
function resolveArrowBindings(batchElements: ServerElement[]): void {
  const elementMap = new Map<string, ServerElement>();
  batchElements.forEach(el => elementMap.set(el.id, el));

  // Also check existing elements for cross-batch references
  elements.forEach((el, id) => {
    if (!elementMap.has(id)) elementMap.set(id, el);
  });

  for (const el of batchElements) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const startRef = (el as any).start as { id: string } | undefined;
    const endRef = (el as any).end as { id: string } | undefined;

    if (!startRef && !endRef) continue;

    const startEl = startRef ? elementMap.get(startRef.id) : undefined;
    const endEl = endRef ? elementMap.get(endRef.id) : undefined;

    // Calculate arrow path from edge to edge
    const startCenter = startEl
      ? { x: startEl.x + (startEl.width || 0) / 2, y: startEl.y + (startEl.height || 0) / 2 }
      : { x: el.x, y: el.y };
    const endCenter = endEl
      ? { x: endEl.x + (endEl.width || 0) / 2, y: endEl.y + (endEl.height || 0) / 2 }
      : { x: el.x + 100, y: el.y };

    const GAP = 8;
    const startPt = startEl
      ? computeEdgePoint(startEl, endCenter.x, endCenter.y)
      : startCenter;
    const endPt = endEl
      ? computeEdgePoint(endEl, startCenter.x, startCenter.y)
      : endCenter;

    // Apply gap: move start point slightly away from source, end point slightly away from target
    const startDx = endPt.x - startPt.x;
    const startDy = endPt.y - startPt.y;
    const startDist = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
    const endDx = startPt.x - endPt.x;
    const endDy = startPt.y - endPt.y;
    const endDist = Math.sqrt(endDx * endDx + endDy * endDy) || 1;

    const finalStart = {
      x: startPt.x + (startDx / startDist) * GAP,
      y: startPt.y + (startDy / startDist) * GAP
    };
    const finalEnd = {
      x: endPt.x + (endDx / endDist) * GAP,
      y: endPt.y + (endDy / endDist) * GAP
    };

    // Set arrow position and points
    el.x = finalStart.x;
    el.y = finalStart.y;
    el.points = [[0, 0], [finalEnd.x - finalStart.x, finalEnd.y - finalStart.y]];

    // Do NOT delete `start` and `end` here.
    // Excalidraw's frontend `convertToExcalidrawElements` method looks for these exact properties
    // to calculate mathematically sound `startBinding`, `endBinding`, `focus`, `gap`, and `boundElements`.
  }
}

// Batch create elements
app.post('/api/elements/batch', (req: Request, res: Response) => {
  try {
    const { elements: elementsToCreate } = req.body;

    if (!Array.isArray(elementsToCreate)) {
      return res.status(400).json({
        success: false,
        error: 'Expected an array of elements'
      });
    }

    const createdElements: ServerElement[] = [];

    elementsToCreate.forEach(elementData => {
      const params = CreateElementSchema.parse(elementData);
      // Prioritize passed ID (for MCP sync), otherwise generate new ID
      const id = params.id || generateId();
      const element: ServerElement = {
        id,
        ...params,
        fontFamily: normalizeFontFamily(params.fontFamily),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };

      createdElements.push(element);
    });

    // Resolve arrow bindings (computes positions, startBinding, endBinding, boundElements)
    resolveArrowBindings(createdElements);

    // Store all elements after binding resolution
    createdElements.forEach(el => elements.set(el.id, el));

    // Broadcast to all connected clients
    const message: BatchCreatedMessage = {
      type: 'elements_batch_created',
      elements: createdElements
    };
    broadcast(message);

    res.json({
      success: true,
      elements: createdElements,
      count: createdElements.length
    });
  } catch (error) {
    logger.error('Error batch creating elements:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Convert Mermaid diagram to Excalidraw elements
app.post('/api/elements/from-mermaid', (req: Request, res: Response) => {
  try {
    const { mermaidDiagram, config } = req.body;

    if (!mermaidDiagram || typeof mermaidDiagram !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Mermaid diagram definition is required'
      });
    }

    logger.info('Received Mermaid conversion request', {
      diagramLength: mermaidDiagram.length,
      hasConfig: !!config
    });

    // Broadcast to all WebSocket clients to process the Mermaid diagram
    broadcast({
      type: 'mermaid_convert',
      mermaidDiagram,
      config: config || {},
      timestamp: new Date().toISOString()
    });

    // Return the diagram for frontend processing
    res.json({
      success: true,
      mermaidDiagram,
      config: config || {},
      message: 'Mermaid diagram sent to frontend for conversion.'
    });
  } catch (error) {
    logger.error('Error processing Mermaid diagram:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Sync elements from frontend (overwrite sync)
app.post('/api/elements/sync', (req: Request, res: Response) => {
  try {
    const { elements: frontendElements, timestamp } = req.body;

    logger.info(`Sync request received: ${frontendElements.length} elements`, {
      timestamp,
      elementCount: frontendElements.length
    });

    // Validate input data
    if (!Array.isArray(frontendElements)) {
      return res.status(400).json({
        success: false,
        error: 'Expected elements to be an array'
      });
    }

    // Record element count before sync
    const beforeCount = elements.size;

    // 1. Clear existing memory storage
    elements.clear();
    logger.info(`Cleared existing elements: ${beforeCount} elements removed`);

    // 2. Batch write new data
    let successCount = 0;
    const processedElements: ServerElement[] = [];

    frontendElements.forEach((element: any, index: number) => {
      try {
        // Ensure element has ID, generate one if missing
        const elementId = element.id || generateId();

        // Add server metadata
        const processedElement: ServerElement = {
          ...element,
          id: elementId,
          syncedAt: new Date().toISOString(),
          source: 'frontend_sync',
          syncTimestamp: timestamp,
          version: 1
        };

        // Store to memory
        elements.set(elementId, processedElement);
        processedElements.push(processedElement);
        successCount++;

      } catch (elementError) {
        logger.warn(`Failed to process element ${index}:`, elementError);
      }
    });

    logger.info(`Sync completed: ${successCount}/${frontendElements.length} elements synced`);

    // 3. Broadcast sync event to all WebSocket clients
    broadcast({
      type: 'elements_synced',
      count: successCount,
      timestamp: new Date().toISOString(),
      source: 'manual_sync'
    });

    // 4. Return sync results
    res.json({
      success: true,
      message: `Successfully synced ${successCount} elements`,
      count: successCount,
      syncedAt: new Date().toISOString(),
      beforeCount,
      afterCount: elements.size
    });

  } catch (error) {
    logger.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      details: 'Internal server error during sync operation'
    });
  }
});

// ─── Files API (for image elements) ───────────────────────────
// GET all files
app.get('/api/files', (_req: Request, res: Response) => {
  const filesObj: Record<string, ExcalidrawFile> = {};
  files.forEach((f, id) => { filesObj[id] = f; });
  res.json({ files: filesObj });
});

// POST add/update files (batch)
app.post('/api/files', (req: Request, res: Response) => {
  const body = req.body;
  const fileList: ExcalidrawFile[] = Array.isArray(body) ? body : (body?.files || []);
  for (const f of fileList) {
    if (f.id && f.dataURL) {
      files.set(f.id, { id: f.id, dataURL: f.dataURL, mimeType: f.mimeType || 'image/png', created: f.created || Date.now() });
    }
  }
  // Broadcast files to connected clients
  broadcast({ type: 'files_added', files: fileList });
  res.json({ success: true, count: fileList.length });
});

// DELETE a file
app.delete('/api/files/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (files.delete(id)) {
    broadcast({ type: 'file_deleted', fileId: id });
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: `File with ID ${id} not found` });
  }
});

// Image export: request (MCP -> Express -> WebSocket -> Frontend)
interface PendingExport {
  resolve: (data: { format: string; data: string }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  collectionTimeout: ReturnType<typeof setTimeout> | null;
  bestResult: { format: string; data: string } | null;
}
const pendingExports = new Map<string, PendingExport>();

app.post('/api/export/image', (req: Request, res: Response) => {
  try {
    const { format, background } = req.body;

    if (!format || !['png', 'svg'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'format must be "png" or "svg"'
      });
    }

    if (clients.size === 0) {
      return res.status(503).json({
        success: false,
        error: 'No frontend client connected. Open the canvas in a browser first.'
      });
    }

    const requestId = generateId();

    const exportPromise = new Promise<{ format: string; data: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = pendingExports.get(requestId);
        pendingExports.delete(requestId);
        // If we collected any result during the window, use it
        if (pending?.bestResult) {
          resolve(pending.bestResult);
        } else {
          reject(new Error('Export timed out after 30 seconds'));
        }
      }, 30000);

      pendingExports.set(requestId, { resolve, reject, timeout, collectionTimeout: null, bestResult: null });
    });

    // Re-broadcast current elements so all connected clients (including stale ones)
    // sync to the canonical server state before exporting
    const filesObj: Record<string, ExcalidrawFile> = {};
    files.forEach((f, id) => { filesObj[id] = f; });
    broadcast({
      type: 'initial_elements',
      elements: Array.from(elements.values()),
      ...(files.size > 0 ? { files: filesObj } : {})
    } as InitialElementsMessage & { files?: Record<string, ExcalidrawFile> });

    // Give browsers time to process the reload before requesting export
    setTimeout(() => {
      broadcast({
        type: 'export_image_request',
        requestId,
        format,
        background: background ?? true
      });
    }, 800);

    exportPromise
      .then(result => {
        res.json({
          success: true,
          format: result.format,
          data: result.data
        });
      })
      .catch(error => {
        res.status(500).json({
          success: false,
          error: (error as Error).message
        });
      });
  } catch (error) {
    logger.error('Error initiating image export:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Image export: result (Frontend -> Express -> MCP)
app.post('/api/export/image/result', (req: Request, res: Response) => {
  try {
    const { requestId, format, data, error } = req.body;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: 'requestId is required'
      });
    }

    const pending = pendingExports.get(requestId);
    if (!pending) {
      // Already resolved by another client, or expired — ignore silently
      return res.json({ success: true });
    }

    if (error) {
      // Don't reject on error — another WebSocket client may still succeed.
      logger.warn(`Export error from one client (requestId=${requestId}): ${error}`);
      return res.json({ success: true });
    }

    // Keep the largest response (most complete canvas state wins)
    if (!pending.bestResult || data.length > pending.bestResult.data.length) {
      pending.bestResult = { format, data };
    }

    // Start a short collection window on the first response, then resolve with best
    if (!pending.collectionTimeout) {
      pending.collectionTimeout = setTimeout(() => {
        const p = pendingExports.get(requestId);
        if (p?.bestResult) {
          clearTimeout(p.timeout);
          pendingExports.delete(requestId);
          p.resolve(p.bestResult);
        }
      }, 3000);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error processing export result:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Viewport control: request (MCP -> Express -> WebSocket -> Frontend)
interface PendingViewport {
  resolve: (data: { success: boolean; message: string }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const pendingViewports = new Map<string, PendingViewport>();

app.post('/api/viewport', (req: Request, res: Response) => {
  try {
    const { scrollToContent, scrollToElementId, zoom, offsetX, offsetY } = req.body;

    if (clients.size === 0) {
      return res.status(503).json({
        success: false,
        error: 'No frontend client connected. Open the canvas in a browser first.'
      });
    }

    const requestId = generateId();

    const viewportPromise = new Promise<{ success: boolean; message: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingViewports.delete(requestId);
        reject(new Error('Viewport request timed out after 10 seconds'));
      }, 10000);

      pendingViewports.set(requestId, { resolve, reject, timeout });
    });

    broadcast({
      type: 'set_viewport',
      requestId,
      scrollToContent,
      scrollToElementId,
      zoom,
      offsetX,
      offsetY
    });

    viewportPromise
      .then(result => {
        res.json(result);
      })
      .catch(error => {
        res.status(500).json({
          success: false,
          error: (error as Error).message
        });
      });
  } catch (error) {
    logger.error('Error initiating viewport change:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Viewport control: result (Frontend -> Express -> MCP)
app.post('/api/viewport/result', (req: Request, res: Response) => {
  try {
    const { requestId, success, message, error } = req.body;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: 'requestId is required'
      });
    }

    const pending = pendingViewports.get(requestId);
    if (!pending) {
      return res.json({ success: true });
    }

    if (error) {
      clearTimeout(pending.timeout);
      pendingViewports.delete(requestId);
      pending.resolve({ success: false, message: error });
      return res.json({ success: true });
    }

    clearTimeout(pending.timeout);
    pendingViewports.delete(requestId);
    pending.resolve({ success: true, message: message || 'Viewport updated' });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error processing viewport result:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Snapshots: save
app.post('/api/snapshots', (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Snapshot name is required'
      });
    }

    const snapshot: Snapshot = {
      name,
      elements: Array.from(elements.values()),
      createdAt: new Date().toISOString()
    };

    snapshots.set(name, snapshot);
    logger.info(`Snapshot saved: "${name}" with ${snapshot.elements.length} elements`);

    res.json({
      success: true,
      name,
      elementCount: snapshot.elements.length,
      createdAt: snapshot.createdAt
    });
  } catch (error) {
    logger.error('Error saving snapshot:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Snapshots: list
app.get('/api/snapshots', (req: Request, res: Response) => {
  try {
    const list = Array.from(snapshots.values()).map(s => ({
      name: s.name,
      elementCount: s.elements.length,
      createdAt: s.createdAt
    }));

    res.json({
      success: true,
      snapshots: list,
      count: list.length
    });
  } catch (error) {
    logger.error('Error listing snapshots:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Snapshots: get by name
app.get('/api/snapshots/:name', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const snapshot = snapshots.get(name!);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: `Snapshot "${name}" not found`
      });
    }

    res.json({
      success: true,
      snapshot
    });
  } catch (error) {
    logger.error('Error fetching snapshot:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Serve the frontend
app.get('/', (req: Request, res: Response, next: NextFunction) => {
  if (options.rootHandler) {
    return options.rootHandler(req, res, next);
  }
  if (!options.serveStaticFrom) {
    return res.status(503).type('html').send(
      `<!doctype html><html><body><h1>ExcaliClaude — frontend non configurato</h1></body></html>`,
    );
  }
  const htmlFile = path.join(options.serveStaticFrom, 'index.html');
  res.sendFile(htmlFile, (err: unknown) => {
    if (err) {
      logger.error('Error serving frontend:', err);
      res
        .status(503)
        .type('html')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><title>ExcaliClaude — build in corso</title>` +
            `<style>body{font-family:-apple-system,system-ui,sans-serif;padding:3rem;max-width:40rem;margin:auto;color:#222}code{background:#f3f3f3;padding:.15rem .4rem;border-radius:4px}</style></head>` +
            `<body><h1>ExcaliClaude — frontend non ancora pronto</h1>` +
            `<p>Il bundle del frontend non è stato trovato. Di solito viene generato automaticamente alla prima apertura del canvas.</p>` +
            `<p>Se vedi questa pagina, prova a ricaricare tra qualche secondo oppure esegui manualmente dal root del plugin:</p>` +
            `<pre><code>npm install\nnpm run build</code></pre>` +
            `</body></html>`,
        );
    }
  });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    elements_count: elements.size,
    websocket_clients: clients.size
  });
});

// Sync status endpoint
app.get('/api/sync/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    elementCount: elements.size,
    timestamp: new Date().toISOString(),
    memoryUsage: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
    },
    websocketClients: clients.size
  });
});

// ═════════════════════════════════════════════════════════════════
// ExcaliClaude — Claude-side endpoints
// ═════════════════════════════════════════════════════════════════
//
// These endpoints implement the bidirectional bridge between the MCP
// server (where Claude runs) and the canvas frontend (where the human
// draws). See docs/analisi-excaliclaude.md for the full protocol.
//
// ── 1. Signal system ────────────────────────────────────────────
// The MCP tool `wait_for_human` opens a long-poll on /api/claude/wait-for-signal.
// When the human clicks "👀 Claude, guarda!" the frontend POSTs to
// /api/claude/signal, which resolves all pending long-polls with the
// current canvas summary + any message.

interface PendingSignal {
  resolve: (value: any) => void;
  timeout: NodeJS.Timeout;
}
const pendingSignalResolvers: PendingSignal[] = [];
// Signals received while no wait_for_human is active are buffered here and
// delivered on the next wait_for_human call (FIFO). Without this, user
// sidebar messages typed between tool turns are silently dropped.
const queuedSignals: any[] = [];

interface ChatMessage {
  id: string;
  sender: 'claude' | 'human';
  type: 'text' | 'action' | 'question' | 'annotation' | 'system' | 'info' | 'suggestion';
  content: string;
  timestamp: string;
  elements_affected?: string[];
}
const claudeMessages: ChatMessage[] = [];

// Claude "thinking" / tool activity status (Feature 1)
interface ClaudeStatus {
  busy: boolean;
  tool: string | null;
  label: string | null;
}
let claudeStatus: ClaudeStatus = { busy: false, tool: null, label: null };
let claudeBusyTimeout: NodeJS.Timeout | null = null;

const TOOL_LABELS: Record<string, (args?: any) => string> = {
  create_element: (a) => `Drawing ${a?.type || 'element'}...`,
  batch_create_elements: () => 'Drawing batch...',
  update_element: () => 'Updating element...',
  delete_element: () => 'Deleting element...',
  query_elements: () => 'Searching elements...',
  get_element: () => 'Reading element...',
  describe_scene: () => 'Reading scene...',
  get_canvas_screenshot: () => 'Looking at canvas...',
  create_from_mermaid: () => 'Rendering mermaid...',
  annotate: () => 'Annotating...',
  save_session: () => 'Saving session...',
  export_scene: () => 'Exporting scene...',
  export_to_image: () => 'Exporting image...',
  align_elements: () => 'Aligning...',
  distribute_elements: () => 'Distributing...',
  group_elements: () => 'Grouping...',
  ungroup_elements: () => 'Ungrouping...',
  duplicate_elements: () => 'Duplicating...',
  lock_elements: () => 'Locking...',
  unlock_elements: () => 'Unlocking...',
  set_viewport: () => 'Adjusting viewport...',
  clear_canvas: () => 'Clearing canvas...',
};

function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()) + '...';
}

function setClaudeStatus(next: ClaudeStatus): void {
  claudeStatus = next;
  broadcast({ type: 'claude_status', ...next } as any);
  if (claudeBusyTimeout) {
    clearTimeout(claudeBusyTimeout);
    claudeBusyTimeout = null;
  }
  if (next.busy) {
    claudeBusyTimeout = setTimeout(() => {
      logger.info('[claude_status] safety timeout fired — resetting busy');
      claudeStatus = { busy: false, tool: null, label: null };
      broadcast({ type: 'claude_status', ...claudeStatus } as any);
      claudeBusyTimeout = null;
    }, 90_000);
  }
}

interface ChangeLogEntry {
  element_id: string;
  action: 'created' | 'updated' | 'deleted';
  author: 'human' | 'claude';
  timestamp: Date;
}
const changeLog: ChangeLogEntry[] = [];

function generateCanvasSummary(): string {
  const count = elements.size;
  if (count === 0) return 'Canvas vuoto.';
  const byType: Record<string, number> = {};
  for (const el of elements.values()) {
    byType[el.type] = (byType[el.type] || 0) + 1;
  }
  const parts = Object.entries(byType)
    .map(([t, n]) => `${n} ${t}`)
    .join(', ');
  return `${count} elementi sul canvas (${parts}).`;
}

function summarizeChanges(changes: ChangeLogEntry[]): string {
  if (changes.length === 0) return 'Nessuna modifica dall\'ultimo check.';
  const created = changes.filter((c) => c.action === 'created').length;
  const updated = changes.filter((c) => c.action === 'updated').length;
  const deleted = changes.filter((c) => c.action === 'deleted').length;
  return `Umano: ${created} creati, ${updated} aggiornati, ${deleted} eliminati.`;
}

// Feature 3: build a compact markdown transcript of the current session by
// filtering out noise (action/system/info) and keeping only substantive turns.
function buildSessionMemoryMarkdown(title: string): string {
  const significant = claudeMessages.filter((m) =>
    m.type === 'text' || m.type === 'question' || m.type === 'annotation' || m.type === 'suggestion',
  );
  const lines: string[] = [];
  lines.push(`# Session: ${title}`);
  lines.push(`Saved: ${new Date().toISOString()}`);
  lines.push(`Element count: ${elements.size}`);
  lines.push('');
  lines.push('## Conversation');
  if (significant.length === 0) {
    lines.push('_(no significant dialogue)_');
  } else {
    for (const m of significant) {
      const who = m.sender === 'human' ? 'You' : 'Claude';
      const tag = m.type && m.type !== 'text' ? ` _(${m.type})_` : '';
      let body = (m.content || '').replace(/\s+$/g, '');
      if (body.length > 500) body = body.slice(0, 500) + '…';
      lines.push(`**${who}${tag}:** ${body}`);
    }
  }
  lines.push('');
  lines.push('## Canvas summary at save time');
  lines.push(generateCanvasSummary());
  lines.push('');
  return lines.join('\n');
}

// POST /api/claude/wait-for-signal — long-poll (chiamato dal MCP server)
app.post('/api/claude/wait-for-signal', async (req: Request, res: Response) => {
  const { timeout_ms = 300_000 } = req.body || {};
  if (queuedSignals.length > 0) {
    const queued = queuedSignals.shift()!;
    logger.info(`[signal] wait-for-signal served from queue (remaining=${queuedSignals.length})`);
    return res.json(queued);
  }
  logger.info(`[signal] wait-for-signal registered (timeout=${timeout_ms}ms, pending=${pendingSignalResolvers.length + 1})`);
  const result = await new Promise<any>((resolve) => {
    const timeout = setTimeout(() => {
      const idx = pendingSignalResolvers.findIndex((p) => p.resolve === resolve);
      if (idx !== -1) pendingSignalResolvers.splice(idx, 1);
      logger.info(`[signal] wait-for-signal TIMEOUT after ${timeout_ms}ms`);
      resolve({ signal_type: 'timeout' });
    }, timeout_ms);
    pendingSignalResolvers.push({ resolve, timeout });
  });
  res.json(result);
});

// POST /api/claude/signal — chiamato dal frontend quando l'umano clicca
app.post('/api/claude/signal', (req: Request, res: Response) => {
  const { signal_type, message, sceneUnchangedSinceLastTurn } = req.body || {};
  logger.info(`[signal] RECEIVED from frontend: type=${signal_type} message="${(message || '').slice(0, 120)}" pending=${pendingSignalResolvers.length} sceneUnchanged=${!!sceneUnchangedSinceLastTurn}`);
  const summary = generateCanvasSummary();
  const recentHumanChanges = changeLog.filter(
    (c) => c.author === 'human' && Date.now() - c.timestamp.getTime() < 60_000,
  );
  // Consume one-shot session memory if set by a recent load (Feature 3).
  const sessionMemory = pendingSessionMemory;
  if (sessionMemory) pendingSessionMemory = null;
  const payload = {
    signal_type: signal_type || 'look',
    message,
    canvas_summary: summary,
    changed_elements: recentHumanChanges,
    element_count: elements.size,
    sceneUnchangedSinceLastTurn: !!sceneUnchangedSinceLastTurn,
    sessionMemory,
  };
  if (pendingSignalResolvers.length > 0) {
    while (pendingSignalResolvers.length > 0) {
      const { resolve, timeout } = pendingSignalResolvers.shift()!;
      clearTimeout(timeout);
      resolve(payload);
    }
  } else {
    queuedSignals.push(payload);
    logger.info(`[signal] no pending wait_for_human — queued (depth=${queuedSignals.length})`);
  }
  // Broadcast via WebSocket per informare altri client
  broadcast({ type: 'human_signal', signal_type, message } as any);
  // Optimistic: Claude now has the turn — show Thinking indicator.
  setClaudeStatus({ busy: true, tool: null, label: 'Thinking...' });
  res.json({ ok: true });
});

// POST /api/claude/tool-activity — called by the MCP dispatcher on each tool
// start/end so the sidebar can display what Claude is currently doing.
app.post('/api/claude/tool-activity', (req: Request, res: Response) => {
  const { tool, phase, args } = req.body || {};
  if (typeof tool !== 'string' || (phase !== 'start' && phase !== 'end')) {
    return res.status(400).json({ ok: false, error: 'invalid body' });
  }
  if (phase === 'start') {
    const labelFn = TOOL_LABELS[tool];
    const label = labelFn ? labelFn(args) : humanizeToolName(tool);
    setClaudeStatus({ busy: true, tool, label });
  } else if (claudeStatus.tool === tool) {
    // Keep busy=true but clear current tool label → fall back to Thinking.
    setClaudeStatus({ busy: true, tool: null, label: 'Thinking...' });
  }
  res.json({ ok: true });
});

// POST /api/claude/message — Claude manda un messaggio alla sidebar
app.post('/api/claude/message', (req: Request, res: Response) => {
  const msg: ChatMessage = {
    id: generateId(),
    sender: 'claude',
    type: (req.body?.type as any) || 'info',
    content: req.body?.message || '',
    timestamp: req.body?.timestamp || new Date().toISOString(),
  };
  claudeMessages.push(msg);
  broadcast({ type: 'claude_message', message: msg } as any);
  // Final claude message → turn finished, clear busy.
  setClaudeStatus({ busy: false, tool: null, label: null });
  res.json({ ok: true, id: msg.id });
});

// GET /api/claude/messages — storico messaggi (frontend load)
app.get('/api/claude/messages', (req: Request, res: Response) => {
  res.json(claudeMessages);
});

// ── 2. Annotations ─────────────────────────────────────────────
// Crea elementi Excalidraw che formano un'annotazione Claude (rettangolo
// colorato + testo + freccia tratteggiata verso il target).

function getElementBounds(el: ServerElement): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
} {
  const x = el.x || 0;
  const y = el.y || 0;
  const w = (el as any).width || 0;
  const h = (el as any).height || 0;
  return {
    left: x,
    right: x + w,
    top: y,
    bottom: y + h,
    centerX: x + w / 2,
    centerY: y + h / 2,
  };
}

function createAnnotationElements(opts: {
  target?: ServerElement;
  text: string;
  position: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  style: 'note' | 'comment' | 'highlight' | 'question';
}): ServerElement[] {
  const { target, text, style } = opts;
  let position = opts.position;

  let x: number, y: number;
  if (target) {
    const b = getElementBounds(target);
    const offset = 30;
    if (position === 'auto') position = 'right';
    switch (position) {
      case 'right':
        x = b.right + offset;
        y = b.top;
        break;
      case 'left':
        x = b.left - 250 - offset;
        y = b.top;
        break;
      case 'top':
        x = b.left;
        y = b.top - 80 - offset;
        break;
      case 'bottom':
        x = b.left;
        y = b.bottom + offset;
        break;
      default:
        x = b.right + offset;
        y = b.top;
    }
  } else {
    x = 50;
    y = 50;
  }

  const styleColors: Record<
    string,
    { bg: string; stroke: string; text: string }
  > = {
    note: { bg: '#F0EDFF', stroke: '#7C5CFC', text: '#1A1523' },
    comment: { bg: '#FFF8E1', stroke: '#F59E0B', text: '#78350F' },
    highlight: { bg: '#ECFDF5', stroke: '#10B981', text: '#064E3B' },
    question: { bg: '#EFF6FF', stroke: '#3B82F6', text: '#1E3A5F' },
  };
  const colors = styleColors[style] || styleColors.note;

  const textWidth = Math.min(Math.max(text.length * 7, 120), 240);
  const approxLines = Math.max(1, Math.ceil((text.length * 7) / textWidth));
  const textHeight = approxLines * 20 + 16;

  const rectId = generateId();
  const textId = generateId();
  const arrowId = generateId();
  const groupId = generateId();
  const now = new Date().toISOString();

  const elems: ServerElement[] = [];

  // 1. Rounded rectangle container
  elems.push({
    id: rectId,
    type: 'rectangle',
    x,
    y,
    width: textWidth + 24,
    height: textHeight,
    strokeColor: colors.stroke,
    backgroundColor: colors.bg,
    strokeWidth: 1,
    opacity: 90,
    boundElements: [{ id: textId, type: 'text' }],
    createdAt: now,
    updatedAt: now,
    version: 1,
  } as any);

  // 2. Text inside the rectangle
  elems.push({
    id: textId,
    type: 'text',
    x: x + 12,
    y: y + 8,
    width: textWidth,
    height: textHeight - 16,
    text,
    fontSize: 14,
    fontFamily: 1,
    strokeColor: colors.text,
    containerId: rectId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  } as any);

  // 3. Dashed arrow to target (if any)
  if (target) {
    const tb = getElementBounds(target);
    const startX = x;
    const startY = y + textHeight / 2;
    elems.push({
      id: arrowId,
      type: 'arrow',
      x: startX,
      y: startY,
      width: tb.centerX - startX,
      height: tb.centerY - startY,
      strokeColor: colors.stroke,
      strokeStyle: 'dashed',
      strokeWidth: 1,
      opacity: 60,
      start: { id: rectId },
      end: { id: target.id },
      createdAt: now,
      updatedAt: now,
      version: 1,
    } as any);
  }

  return elems;
}

// POST /api/claude/annotate
app.post('/api/claude/annotate', (req: Request, res: Response) => {
  try {
    const { target_element_id, text, position = 'auto', style = 'note' } = req.body || {};
    const target = target_element_id ? elements.get(target_element_id) : undefined;
    const annotationElements = createAnnotationElements({
      target,
      text: text || '',
      position,
      style,
    });
    for (const el of annotationElements) {
      elements.set(el.id, el);
      changeLog.push({
        element_id: el.id,
        action: 'created',
        author: 'claude',
        timestamp: new Date(),
      });
    }
    broadcast({
      type: 'elements_batch_created',
      elements: annotationElements,
      count: annotationElements.length,
    } as any);
    res.json({
      ok: true,
      elements_created: annotationElements.length,
      annotation_id: annotationElements[0]?.id,
    });
  } catch (err) {
    logger.error('annotate failed', err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 3. Human changes tracking ──────────────────────────────────
// GET /api/claude/human-changes?since=<iso>
app.get('/api/claude/human-changes', (req: Request, res: Response) => {
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);
  const humanChanges = changeLog.filter(
    (c) => c.author === 'human' && c.timestamp > since,
  );
  res.json({
    changes: humanChanges,
    summary: summarizeChanges(humanChanges),
    since: since.toISOString(),
    until: new Date().toISOString(),
  });
});

// ── 4. Scene export (per save_session MCP tool) ────────────────
app.get('/api/export/scene', (req: Request, res: Response) => {
  const scene = {
    type: 'excalidraw',
    version: 2,
    source: 'excaliclaude',
    elements: Array.from(elements.values()),
    appState: { viewBackgroundColor: '#FFFFFF' },
    files: Object.fromEntries(files),
  };
  res.json(scene);
});

// POST /api/claude/save — writes current scene to disk under
// $CWD/excalidraw/<slug>-<timestamp>.excalidraw. Returns the saved path.
app.post('/api/claude/save', (req: Request, res: Response) => {
  try {
    const title: string = (req.body?.title || options.title || 'canvas') as string;
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'canvas';
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace(/T/, '_')
      .replace(/Z$/, '');
    const outDir = path.join(process.cwd(), 'excalidraw');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}-${stamp}.excalidraw`);
    const scene = {
      type: 'excalidraw',
      version: 2,
      source: 'excaliclaude',
      elements: Array.from(elements.values()),
      appState: { viewBackgroundColor: '#FFFFFF' },
      files: Object.fromEntries(files),
    };
    fs.writeFileSync(outPath, JSON.stringify(scene, null, 2), 'utf-8');
    logger.info(`[save] scene saved to ${outPath} (${elements.size} elements)`);
    // Companion session memory (.md) — Feature 3.
    let memoryPath: string | null = null;
    try {
      memoryPath = outPath.replace(/\.excalidraw$/, '.md');
      const md = buildSessionMemoryMarkdown(title);
      fs.writeFileSync(memoryPath, md, 'utf-8');
      logger.info(`[save] session memory saved to ${memoryPath}`);
    } catch (memErr) {
      logger.warn(`[save] session memory write failed: ${(memErr as Error).message}`);
      memoryPath = null;
    }
    res.json({ ok: true, path: outPath, memoryPath, elementCount: elements.size });
  } catch (err) {
    logger.error('[save] failed:', err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/claude/quit — tells the process to shut down. Responds first,
// then invokes the caller-provided shutdown hook (or falls back to
// process.exit) on next tick so the client receives the reply.
app.post('/api/claude/quit', (_req: Request, res: Response) => {
  logger.info('[quit] received quit request, shutting down in 150ms');
  res.json({ ok: true });
  setTimeout(() => {
    try {
      if (options.onQuit) options.onQuit();
      else process.exit(0);
    } catch (err) {
      logger.error('[quit] onQuit threw:', err);
      process.exit(1);
    }
  }, 150);
});

// POST /api/import — re-idrata una scena caricata da file .excalidraw
app.post('/api/import', (req: Request, res: Response) => {
  try {
    const scene = req.body || {};
    if (Array.isArray(scene.elements)) {
      elements.clear();
      for (const el of scene.elements as ServerElement[]) {
        elements.set(el.id, el);
      }
      broadcast({ type: 'initial_elements', elements: Array.from(elements.values()) });
    }
    res.json({ ok: true, count: elements.size });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/claude/session-memory?path=<excalidraw-path>
// Reads the sibling .md file for a given .excalidraw path, if present.
// Path must live inside $CWD/excalidraw to avoid arbitrary file reads.
app.get('/api/claude/session-memory', (req: Request, res: Response) => {
  try {
    const rawPath = String(req.query.path || '');
    if (!rawPath) return res.status(400).json({ ok: false, error: 'missing path' });
    const resolved = path.resolve(rawPath);
    const allowedRoot = path.resolve(path.join(process.cwd(), 'excalidraw'));
    if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
      return res.status(403).json({ ok: false, error: 'path outside allowed root' });
    }
    const mdPath = resolved.replace(/\.excalidraw$/, '.md');
    if (!fs.existsSync(mdPath)) return res.json({ ok: true, memory: null });
    const memory = fs.readFileSync(mdPath, 'utf-8');
    res.json({ ok: true, memory, memoryPath: mdPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/claude/session-memory — arms the one-shot session memory that
// will be delivered to Claude on the next /api/claude/signal.
app.post('/api/claude/session-memory', (req: Request, res: Response) => {
  const memory = typeof req.body?.memory === 'string' ? req.body.memory : null;
  pendingSessionMemory = memory || null;
  logger.info(
    `[session-memory] armed (${pendingSessionMemory ? pendingSessionMemory.length + ' chars' : 'cleared'})`,
  );
  res.json({ ok: true });
});

// Optional final static handler (prod binary serves embedded assets)
if (options.staticHandler) {
  app.use(options.staticHandler);
}

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

const close = async (): Promise<void> => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

const flushPendingSignals = (reason: 'window_closed' | 'shutdown'): number => {
  const count = pendingSignalResolvers.length;
  if (queuedSignals.length > 0) {
    logger.info(`[signal] dropping ${queuedSignals.length} queued signal(s) on ${reason}`);
    queuedSignals.length = 0;
  }
  if (count === 0) return 0;
  logger.info(`[signal] flushing ${count} pending signal(s) (reason=${reason})`);
  const payload = {
    signal_type: reason,
    canvas_summary: generateCanvasSummary(),
    element_count: elements.size,
  };
  while (pendingSignalResolvers.length > 0) {
    const { resolve, timeout } = pendingSignalResolvers.shift()!;
    clearTimeout(timeout);
    resolve(payload);
  }
  return count;
};

return { app, server, wss, close, flushPendingSignals };
}

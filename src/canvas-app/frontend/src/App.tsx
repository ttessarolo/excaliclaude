import React, { useState, useEffect, useRef } from 'react'
import {
  Excalidraw,
  convertToExcalidrawElements,
  CaptureUpdateAction,
  ExcalidrawImperativeAPI,
  exportToBlob,
  exportToSvg
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement, NonDeleted, NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'
import { convertMermaidToExcalidraw, DEFAULT_MERMAID_CONFIG } from './utils/mermaidConverter'
import type { MermaidConfig } from '@excalidraw/mermaid-to-excalidraw'
import { ClaudeSidebar } from './components/ClaudeSidebar'
import { QuitModal } from './components/QuitModal'
import { useClaudeBridge } from './hooks/useClaudeBridge'
import { hashScene } from './lib/sceneHash'
import { registerExcalidrawAPIForClipboard } from './lib/clipboard-bridge'
import { trackElementAuthor } from './utils/element-author'
import './styles/claude-theme.css'

// Type definitions
type ExcalidrawAPIRefValue = ExcalidrawImperativeAPI;

interface ServerElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string | number;
  label?: {
    text: string;
  };
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  syncedAt?: string;
  source?: string;
  syncTimestamp?: string;
  boundElements?: any[] | null;
  containerId?: string | null;
  locked?: boolean;
  // Arrow element binding
  start?: { id: string };
  end?: { id: string };
  strokeStyle?: string;
  endArrowhead?: string;
  startArrowhead?: string;
  // Image element fields
  fileId?: string;
  status?: string;
  scale?: [number, number];
  angle?: number;
  link?: string | null;
}

interface WebSocketMessage {
  type: string;
  element?: ServerElement;
  elements?: ServerElement[];
  elementId?: string;
  count?: number;
  timestamp?: string;
  source?: string;
  mermaidDiagram?: string;
  config?: MermaidConfig;
}

interface ApiResponse {
  success: boolean;
  elements?: ServerElement[];
  element?: ServerElement;
  files?: Record<string, unknown>;
  count?: number;
  error?: string;
  message?: string;
}

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';
const AUTO_SYNC_DEBOUNCE_MS = 1200;

// Helper function to clean elements for Excalidraw
const cleanElementForExcalidraw = (element: ServerElement): Partial<ExcalidrawElement> => {
  const {
    createdAt,
    updatedAt,
    version,
    syncedAt,
    source,
    syncTimestamp,
    ...cleanElement
  } = element;
  return cleanElement;
}

// Helper function to validate and fix element binding data
const validateAndFixBindings = (elements: Partial<ExcalidrawElement>[]): Partial<ExcalidrawElement>[] => {
  const elementMap = new Map(elements.map(el => [el.id!, el]));

  return elements.map(element => {
    const fixedElement = { ...element };

    // Validate and fix boundElements
    if (fixedElement.boundElements) {
      if (Array.isArray(fixedElement.boundElements)) {
        fixedElement.boundElements = fixedElement.boundElements.filter((binding: any) => {
          // Ensure binding has required properties
          if (!binding || typeof binding !== 'object') return false;
          if (!binding.id || !binding.type) return false;

          // Ensure the referenced element exists
          const referencedElement = elementMap.get(binding.id);
          if (!referencedElement) return false;

          // Validate binding type
          if (!['text', 'arrow'].includes(binding.type)) return false;

          return true;
        });

        // Remove boundElements if empty
        if (fixedElement.boundElements.length === 0) {
          fixedElement.boundElements = null;
        }
      } else {
        // Invalid boundElements format, set to null
        fixedElement.boundElements = null;
      }
    }

    // Validate and fix containerId
    if (fixedElement.containerId) {
      const containerElement = elementMap.get(fixedElement.containerId);
      if (!containerElement) {
        // Container doesn't exist, remove containerId
        fixedElement.containerId = null;
      }
    }

    return fixedElement;
  });
}

const isImageElement = (element: Partial<ExcalidrawElement>): boolean => {
  return element.type === 'image'
}

const isShapeContainerType = (type: string | undefined): boolean => {
  return type === 'rectangle' || type === 'ellipse' || type === 'diamond'
}

const recenterBoundShapeTextElements = (
  elements: Partial<ExcalidrawElement>[]
): Partial<ExcalidrawElement>[] => {
  const elementMap = new Map(elements.map((el) => [el.id, el]))

  return elements.map((element) => {
    if (element.type !== 'text' || !element.containerId) {
      return element
    }

    const textElement = element as ExcalidrawElement & { type: 'text'; containerId: string; autoResize?: boolean }
    const container = elementMap.get(textElement.containerId) as (ExcalidrawElement & { x: number; y: number; width: number; height: number }) | undefined
    if (!container || !isShapeContainerType(container.type)) {
      return element
    }

    if (textElement.autoResize === false) {
      return element
    }

    if (
      typeof container.x !== 'number' ||
      typeof container.y !== 'number' ||
      typeof container.width !== 'number' ||
      typeof container.height !== 'number' ||
      typeof textElement.width !== 'number' ||
      typeof textElement.height !== 'number'
    ) {
      return element
    }

    return {
      ...element,
      x: container.x + (container.width - textElement.width) / 2,
      y: container.y + (container.height - textElement.height) / 2,
    }
  })
}

const normalizeImageElement = (element: Partial<ExcalidrawElement>): Partial<ExcalidrawElement> => {
  const img = element as any
  return {
    ...img,
    angle: img.angle || 0,
    strokeColor: img.strokeColor || 'transparent',
    backgroundColor: img.backgroundColor || 'transparent',
    fillStyle: img.fillStyle || 'solid',
    strokeWidth: img.strokeWidth || 1,
    strokeStyle: img.strokeStyle || 'solid',
    roughness: img.roughness ?? 0,
    opacity: img.opacity ?? 100,
    groupIds: img.groupIds || [],
    roundness: null,
    seed: img.seed || Math.floor(Math.random() * 1000000),
    version: img.version || 1,
    versionNonce: img.versionNonce || Math.floor(Math.random() * 1000000),
    isDeleted: img.isDeleted ?? false,
    boundElements: img.boundElements || null,
    link: img.link || null,
    locked: img.locked || false,
    status: img.status || 'saved',
    fileId: img.fileId,
    scale: img.scale || [1, 1],
  }
}

// Helper: restore startBinding/endBinding/boundElements after convertToExcalidrawElements strips them
const restoreBindings = (
  convertedElements: readonly any[],
  originalElements: Partial<ExcalidrawElement>[]
): any[] => {
  const originalMap = new Map<string, any>();
  for (const el of originalElements) {
    if (el.id) originalMap.set(el.id, el);
  }

  return convertedElements.map((el: any) => {
    const orig = originalMap.get(el.id);
    if (!orig) return el;

    const patched = { ...el };

    if (orig.startBinding && !el.startBinding) {
      patched.startBinding = orig.startBinding;
    }
    if (orig.endBinding && !el.endBinding) {
      patched.endBinding = orig.endBinding;
    }
    if (orig.boundElements && (!el.boundElements || el.boundElements.length === 0)) {
      patched.boundElements = orig.boundElements;
    }
    if (orig.elbowed !== undefined && el.elbowed === undefined) {
      patched.elbowed = orig.elbowed;
    }

    return patched;
  });
};

const convertElementsPreservingImageProps = (
  elements: Partial<ExcalidrawElement>[]
): Partial<ExcalidrawElement>[] => {
  if (elements.length === 0) return []

  const validatedElements = validateAndFixBindings(elements)
  const imageElements = validatedElements.filter(isImageElement).map(normalizeImageElement)
  const nonImageElements = validatedElements.filter(el => !isImageElement(el))
  // convertToExcalidrawElements may expand labeled shapes into [shape, textElement],
  // so we cannot assume a 1:1 mapping — return all converted elements directly.
  const convertedNonImageElements = convertToExcalidrawElements(nonImageElements as any, { regenerateIds: false })
  const restoredNonImageElements = restoreBindings(convertedNonImageElements, nonImageElements)
  return recenterBoundShapeTextElements([...restoredNonImageElements, ...imageElements])
}

function App(): JSX.Element {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPIRefValue | null>(null)
  // Ref so WS message handlers (captured in stale closures) always see the latest API instance
  const excalidrawAPIRef = useRef<ExcalidrawAPIRefValue | null>(null)
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI
  }, [excalidrawAPI])
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const websocketRef = useRef<WebSocket | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)
  const [isDark, setIsDark] = useState<boolean>(false)
  const [quitModalOpen, setQuitModalOpen] = useState<boolean>(false)
  const [quitSaving, setQuitSaving] = useState<boolean>(false)
  const claudeBridge = useClaudeBridge(isConnected)

  // Scene diff detection (Feature 2): hash of the scene at the moment of
  // the last signal sent to Claude. If unchanged, we tell Claude to reuse
  // the previous description instead of calling describe_scene again.
  const lastSignalSceneHashRef = useRef<string | null>(null)

  // Sync state management
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncInFlightRef = useRef<boolean>(false)
  const suppressAutoSyncCountRef = useRef<number>(0)
  const userInteractedRef = useRef<boolean>(false)

  const applySceneUpdateWithoutAutoSync = (
    api: ExcalidrawImperativeAPI,
    scene: Parameters<ExcalidrawImperativeAPI['updateScene']>[0]
  ): void => {
    suppressAutoSyncCountRef.current += 1
    api.updateScene(scene)
    setTimeout(() => {
      suppressAutoSyncCountRef.current = Math.max(0, suppressAutoSyncCountRef.current - 1)
    }, 0)
  }

  useEffect(() => {
    return () => {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current)
      }
    }
  }, [])

  // WebSocket connection
  useEffect(() => {
    connectWebSocket()
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close()
      }
    }
  }, [])

  // Load existing elements when Excalidraw API becomes available
  useEffect(() => {
    if (excalidrawAPI) {
      // Force the theme to 'light' at mount to override any value Excalidraw
      // may have restored from localStorage (theme is persisted to browser
      // storage by default). This keeps the initial appearance deterministic
      // regardless of prior sessions or system preference.
      applySceneUpdateWithoutAutoSync(excalidrawAPI, {
        appState: { theme: 'light' as any }
      })
      loadExistingElements()

      // Ensure WebSocket is connected for real-time updates
      if (!isConnected) {
        connectWebSocket()
      }
    }
  }, [excalidrawAPI, isConnected])

  const loadExistingElements = async (): Promise<void> => {
    try {
      const response = await fetch('/api/elements')
      const result: ApiResponse = await response.json()

      if (result.success && result.elements && result.elements.length > 0) {
        const cleanedElements = result.elements.map(cleanElementForExcalidraw)
        const convertedElements = convertElementsPreservingImageProps(cleanedElements)
        if (excalidrawAPI) {
          applySceneUpdateWithoutAutoSync(excalidrawAPI, {
            elements: convertedElements,
            captureUpdate: CaptureUpdateAction.NEVER
          })
        }
      }

      const filesResponse = await fetch('/api/files')
      if (filesResponse.ok) {
        const filesResult = await filesResponse.json() as ApiResponse
        if (filesResult.files) {
          excalidrawAPI?.addFiles(Object.values(filesResult.files))
        }
      }
    } catch (error) {
      console.error('Error loading existing elements:', error)
    }
  }

  const connectWebSocket = (): void => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}`

    websocketRef.current = new WebSocket(wsUrl)

    websocketRef.current.onopen = () => {
      setIsConnected(true)

      if (excalidrawAPI) {
        setTimeout(loadExistingElements, 100)
      }
    }

    websocketRef.current.onmessage = (event: MessageEvent) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data)
        // Forward ExcaliClaude-specific messages to the Claude bridge.
        // The bridge filters its types (claude_message, etc.) and ignores
        // the rest, so we can safely pass every frame through it.
        claudeBridge.handleWsMessage(data)
        handleWebSocketMessage(data)
      } catch (error) {
        console.error('Error parsing WebSocket message:', error, event.data)
      }
    }

    websocketRef.current.onclose = (event: CloseEvent) => {
      setIsConnected(false)

      // Reconnect after 3 seconds if not a clean close
      if (event.code !== 1000) {
        setTimeout(connectWebSocket, 3000)
      }
    }

    websocketRef.current.onerror = (error: Event) => {
      console.error('WebSocket error:', error)
      setIsConnected(false)
    }
  }

  const handleWebSocketMessage = async (data: WebSocketMessage): Promise<void> => {
    const excalidrawAPI = excalidrawAPIRef.current
    if (!excalidrawAPI) {
      return
    }

    try {
      const currentElements = excalidrawAPI.getSceneElements()
      const mergeAndApplySceneElements = (incomingElements: Partial<ExcalidrawElement>[]): void => {
        if (incomingElements.length === 0) return

        const incomingById = new Map<string, Partial<ExcalidrawElement>>()
        incomingElements.forEach((element) => {
          if (element.id) {
            incomingById.set(element.id, element)
          }
        })

        const mergedElements: Partial<ExcalidrawElement>[] = currentElements.map((element) => {
          const incoming = incomingById.get(element.id)
          if (!incoming) return element
          incomingById.delete(element.id)
          return { ...element, ...incoming }
        })

        mergedElements.push(...incomingById.values())

        const convertedElements = convertElementsPreservingImageProps(mergedElements)
        applySceneUpdateWithoutAutoSync(excalidrawAPI, {
          elements: convertedElements,
          captureUpdate: CaptureUpdateAction.NEVER
        })
      }

      switch (data.type) {
        case 'initial_elements':
          if (data.elements && data.elements.length > 0) {
            const cleanedElements = data.elements.map(cleanElementForExcalidraw)
            const convertedElements = convertElementsPreservingImageProps(cleanedElements)
            applySceneUpdateWithoutAutoSync(excalidrawAPI, {
              elements: convertedElements,
              captureUpdate: CaptureUpdateAction.NEVER
            })
          }
          // Load files for image elements
          if ((data as any).files) {
            excalidrawAPI.addFiles(Object.values((data as any).files))
          }
          break

        case 'files_added':
          if (Array.isArray((data as any).files)) {
            excalidrawAPI.addFiles((data as any).files)
          }
          break

        case 'element_created':
          if (data.element) {
            const cleanedNewElement = cleanElementForExcalidraw(data.element)
            // Rebuild against full scene so text/container bindings remain intact.
            mergeAndApplySceneElements([cleanedNewElement])
          }
          break

        case 'element_updated':
          if (data.element) {
            const cleanedUpdatedElement = cleanElementForExcalidraw(data.element)
            // Convert with full scene context so text metrics/container placement can refresh.
            mergeAndApplySceneElements([cleanedUpdatedElement])
          }
          break

        case 'element_deleted':
          if (data.elementId) {
            const filteredElements = currentElements.filter(el => el.id !== data.elementId)
            applySceneUpdateWithoutAutoSync(excalidrawAPI, {
              elements: filteredElements,
              captureUpdate: CaptureUpdateAction.NEVER
            })
          }
          break

        case 'elements_batch_created':
          if (data.elements) {
            const cleanedBatchElements = data.elements.map(cleanElementForExcalidraw)
            mergeAndApplySceneElements(cleanedBatchElements)
          }
          break

        case 'elements_synced':
          console.log(`Sync confirmed by server: ${data.count} elements`)
          // Sync confirmation already handled by HTTP response
          break

        case 'sync_status':
          console.log(`Server sync status: ${data.count} elements`)
          break

        case 'canvas_cleared':
          console.log('Canvas cleared by server')
          applySceneUpdateWithoutAutoSync(excalidrawAPI, {
            elements: [],
            captureUpdate: CaptureUpdateAction.NEVER
          })
          break

        case 'export_image_request':
          if (data.requestId) {
            try {
              const elements = excalidrawAPI.getSceneElements()
              const appState = excalidrawAPI.getAppState()
              const files = excalidrawAPI.getFiles()

              if (data.format === 'svg') {
                const svg = await exportToSvg({
                  elements,
                  appState: {
                    ...appState,
                    exportBackground: data.background !== false
                  },
                  files
                })
                const svgString = new XMLSerializer().serializeToString(svg)
                await fetch('/api/export/image/result', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    requestId: data.requestId,
                    format: 'svg',
                    data: svgString
                  })
                })
              } else {
                const blob = await exportToBlob({
                  elements,
                  appState: {
                    ...appState,
                    exportBackground: data.background !== false
                  },
                  files,
                  mimeType: 'image/png'
                })
                const reader = new FileReader()
                reader.onload = async () => {
                  try {
                    const resultString = reader.result as string
                    const base64 = resultString?.split(',')[1]
                    if (!base64) {
                      throw new Error('Could not extract base64 data from result')
                    }
                    await fetch('/api/export/image/result', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        requestId: data.requestId,
                        format: 'png',
                        data: base64
                      })
                    })
                  } catch (readerError) {
                    console.error('Image export (FileReader) failed:', readerError)
                    await fetch('/api/export/image/result', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        requestId: data.requestId,
                        error: (readerError as Error).message
                      })
                    }).catch(() => { })
                  }
                }
                reader.onerror = async () => {
                  console.error('FileReader error:', reader.error)
                  await fetch('/api/export/image/result', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      requestId: data.requestId,
                      error: reader.error?.message || 'FileReader failed'
                    })
                  }).catch(() => { })
                }
                reader.readAsDataURL(blob)
              }
            } catch (exportError) {
              console.error('Image export failed:', exportError)
              await fetch('/api/export/image/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  requestId: data.requestId,
                  error: (exportError as Error).message
                })
              })
            }
          }
          break

        case 'set_viewport':
          console.log('Received viewport control request', data)
          if (data.requestId) {
            try {
              if (data.scrollToContent) {
                const allElements = excalidrawAPI.getSceneElements()
                if (allElements.length > 0) {
                  excalidrawAPI.scrollToContent(allElements, { fitToViewport: true, animate: true })
                }
              } else if (data.scrollToElementId) {
                const allElements = excalidrawAPI.getSceneElements()
                const targetElement = allElements.find(el => el.id === data.scrollToElementId)
                if (targetElement) {
                  excalidrawAPI.scrollToContent([targetElement], { fitToViewport: false, animate: true })
                } else {
                  throw new Error(`Element ${data.scrollToElementId} not found`)
                }
              } else {
                // Direct zoom/scroll control
                const appState: any = {}
                if (data.zoom !== undefined) {
                  appState.zoom = { value: data.zoom }
                }
                if (data.offsetX !== undefined) {
                  appState.scrollX = data.offsetX
                }
                if (data.offsetY !== undefined) {
                  appState.scrollY = data.offsetY
                }
                if (Object.keys(appState).length > 0) {
                  applySceneUpdateWithoutAutoSync(excalidrawAPI, { appState })
                }
              }

              await fetch('/api/viewport/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  requestId: data.requestId,
                  success: true,
                  message: 'Viewport updated'
                })
              })
            } catch (viewportError) {
              console.error('Viewport control failed:', viewportError)
              await fetch('/api/viewport/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  requestId: data.requestId,
                  error: (viewportError as Error).message
                })
              }).catch(() => { })
            }
          }
          break

        case 'mermaid_convert':
          console.log('Received Mermaid conversion request from MCP')
          if (data.mermaidDiagram) {
            try {
              const result = await convertMermaidToExcalidraw(data.mermaidDiagram, data.config || DEFAULT_MERMAID_CONFIG)

              if (result.error) {
                console.error('Mermaid conversion error:', result.error)
                return
              }

              if (result.elements && result.elements.length > 0) {
                const convertedElements = convertToExcalidrawElements(result.elements, { regenerateIds: false })
                applySceneUpdateWithoutAutoSync(excalidrawAPI, {
                  elements: convertedElements,
                  captureUpdate: CaptureUpdateAction.IMMEDIATELY
                })

                if (result.files) {
                  excalidrawAPI.addFiles(Object.values(result.files))
                }

                console.log('Mermaid diagram converted successfully:', result.elements.length, 'elements')

                // Sync to backend automatically after creating elements
                await syncToBackend()
              }
            } catch (error) {
              console.error('Error converting Mermaid diagram from WebSocket:', error)
            }
          }
          break

        default:
          console.log('Unknown WebSocket message type:', data.type)
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, data)
    }
  }

  // Data format conversion for backend
  const convertToBackendFormat = (element: ExcalidrawElement): ServerElement => {
    return {
      ...element
    } as ServerElement
  }

  // Format sync time display
  const formatSyncTime = (time: Date | null): string => {
    if (!time) return ''
    return time.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  // Main sync function
  const syncToBackend = async (options: { silent?: boolean } = {}): Promise<void> => {
    const { silent = false } = options

    if (!excalidrawAPI) {
      console.warn('Excalidraw API not available')
      return
    }

    if (syncInFlightRef.current) {
      return
    }

    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current)
      autoSyncTimerRef.current = null
    }

    syncInFlightRef.current = true
    if (!silent) {
      setSyncStatus('syncing')
    }

    try {
      // 1. Get current elements
      const currentElements = excalidrawAPI.getSceneElements()
      console.log(`Syncing ${currentElements.length} elements to backend`)

      // Filter out deleted elements
      const activeElements = currentElements.filter(el => !el.isDeleted)

      // 3. Convert to backend format
      const backendElements = activeElements.map(convertToBackendFormat)

      // 4. Send to backend
      const response = await fetch('/api/elements/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          elements: backendElements,
          timestamp: new Date().toISOString()
        })
      })

      if (response.ok) {
        const result: ApiResponse = await response.json()
        setLastSyncTime(new Date())
        console.log(`Sync successful: ${result.count} elements synced`)

        if (!silent) {
          setSyncStatus('success')
          // Reset status after 2 seconds
          setTimeout(() => setSyncStatus('idle'), 2000)
        }
      } else {
        const error: ApiResponse = await response.json()
        console.error('Sync failed:', error.error)
        if (!silent) {
          setSyncStatus('error')
        }
      }
    } catch (error) {
      console.error('Sync error:', error)
      if (!silent) {
        setSyncStatus('error')
      }
    } finally {
      syncInFlightRef.current = false
    }
  }

  const scheduleAutoSync = (): void => {
    if (!isConnected || !excalidrawAPI) {
      return
    }
    if (!userInteractedRef.current) {
      return
    }
    if (suppressAutoSyncCountRef.current > 0) {
      return
    }
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current)
    }

    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null
      if (suppressAutoSyncCountRef.current > 0 || syncInFlightRef.current) {
        return
      }
      void syncToBackend({ silent: true })
    }, AUTO_SYNC_DEBOUNCE_MS)
  }

  const clearCanvas = async (): Promise<void> => {
    if (excalidrawAPI) {
      try {
        // Get all current elements and delete them from backend
        const response = await fetch('/api/elements')
        const result: ApiResponse = await response.json()

        if (result.success && result.elements) {
          const deletePromises = result.elements.map(element =>
            fetch(`/api/elements/${element.id}`, { method: 'DELETE' })
          )
          await Promise.all(deletePromises)
        }

        // Clear the frontend canvas
        applySceneUpdateWithoutAutoSync(excalidrawAPI, {
          elements: [],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY
        })
      } catch (error) {
        console.error('Error clearing canvas:', error)
        // Still clear frontend even if backend fails
        applySceneUpdateWithoutAutoSync(excalidrawAPI, {
          elements: [],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY
        })
      }
    }
  }

  const focusOnElements = (ids: string[]): void => {
    if (!excalidrawAPI || ids.length === 0) return
    const all = excalidrawAPI.getSceneElements()
    const targets = all.filter((el) => ids.includes(el.id))
    if (targets.length > 0) {
      excalidrawAPI.scrollToContent(targets, { fitToViewport: true, animate: true })
    }
  }

  const openQuitModal = (): void => setQuitModalOpen(true)
  const cancelQuit = (): void => setQuitModalOpen(false)

  // Feature 2: wrap sendSignal so we can tell Claude when the scene hasn't
  // changed since the last turn — saves tokens by skipping describe_scene.
  const sendSignalWithDiff = async (
    type: 'look' | 'message',
    message?: string,
  ): Promise<void> => {
    let sceneUnchanged = false
    try {
      const api = excalidrawAPIRef.current
      if (api) {
        const elements = api.getSceneElements() as readonly NonDeletedExcalidrawElement[]
        const hash = await hashScene(elements)
        if (
          lastSignalSceneHashRef.current !== null &&
          lastSignalSceneHashRef.current === hash
        ) {
          sceneUnchanged = true
        }
        lastSignalSceneHashRef.current = hash
      }
    } catch (err) {
      console.warn('[ExcaliClaude] scene hash failed', err)
    }
    await claudeBridge.sendSignal(
      type,
      message,
      sceneUnchanged ? { sceneUnchangedSinceLastTurn: true } : undefined,
    )
  }

  const saveCurrentScene = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/claude/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: claudeBridge.session.title }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data?.path || null
    } catch (err) {
      console.error('[ExcaliClaude] save failed', err)
      return null
    }
  }

  const shutdownServer = (): void => {
    // Fire-and-forget: backend will terminate the webview child, which ends
    // webview.run() in the native window and exits the process.
    fetch('/api/claude/quit', { method: 'POST' }).catch(() => {})
  }

  const confirmSaveAndQuit = async (): Promise<void> => {
    setQuitSaving(true)
    await saveCurrentScene()
    setQuitSaving(false)
    setQuitModalOpen(false)
    shutdownServer()
  }

  const confirmDiscardAndQuit = (): void => {
    setQuitModalOpen(false)
    shutdownServer()
  }

  // Best-effort: browser-level beforeunload intercept. In webview-bun this
  // may not reliably fire for native close, but it covers Cmd+R / in-app
  // navigation cases.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): string | undefined => {
      if (!quitModalOpen) {
        setQuitModalOpen(true)
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
      return undefined
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [quitModalOpen])

  return (
    <div className="excaliclaude-root" data-theme={isDark ? 'dark' : 'light'}>
      <div className="excaliclaude-canvas-wrap">
        <div
          onPointerDownCapture={() => {
            userInteractedRef.current = true
          }}
          onKeyDownCapture={() => {
            userInteractedRef.current = true
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <Excalidraw
            excalidrawAPI={(api: ExcalidrawAPIRefValue) => {
              setExcalidrawAPI(api)
              registerExcalidrawAPIForClipboard(api as any)
            }}
            UIOptions={{ canvasActions: { toggleTheme: true } }}
            onChange={(elements, appState) => {
              // Track elements created through UI as "human"
              trackElementAuthor(elements as any)
              scheduleAutoSync()
              if (appState && typeof (appState as any).theme === 'string') {
                const nextDark = (appState as any).theme === 'dark'
                if (nextDark !== isDark) setIsDark(nextDark)
              }
            }}
            initialData={{
              elements: [],
              appState: {
                theme: isDark ? 'dark' : 'light',
                viewBackgroundColor: isDark ? '#121212' : '#ffffff'
              }
            }}
          />
        </div>
      </div>

      <ClaudeSidebar
        session={claudeBridge.session}
        connected={isConnected}
        messages={claudeBridge.messages}
        claudeStatus={claudeBridge.claudeStatus}
        collapsed={!sidebarOpen}
        onSendSignal={(type, message) => sendSignalWithDiff(type, message)}
        onQuit={openQuitModal}
        onFocusElements={focusOnElements}
      />

      <button
        type="button"
        className={`claude-toggle-handle${sidebarOpen ? '' : ' collapsed'}`}
        onClick={() => {
          setSidebarOpen((v) => !v)
          if (!sidebarOpen) claudeBridge.markAllRead()
        }}
        aria-label={sidebarOpen ? 'Collapse Claude sidebar' : 'Expand Claude sidebar'}
        title={sidebarOpen ? 'Collapse Claude sidebar' : 'Expand Claude sidebar'}
      >
        {sidebarOpen ? '›' : '‹'}
        <span
          className={`dot${claudeBridge.hasUnread && !sidebarOpen ? ' has-unread' : ''}`}
        />
      </button>

      <QuitModal
        open={quitModalOpen}
        saving={quitSaving}
        onSave={confirmSaveAndQuit}
        onDiscard={confirmDiscardAndQuit}
        onCancel={cancelQuit}
      />
    </div>
  )
}

export default App

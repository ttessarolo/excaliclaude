// Clipboard bridge between the webview's internal WebKit clipboard and the
// host OS pasteboard. Relies on two async callbacks exposed from canvas-bin.ts:
//
//   window.__excaliclaude_pb_read(): Promise<string>
//   window.__excaliclaude_pb_write(text: string): Promise<boolean>
//
// Strategy:
//   - copy/cut: passive mirror — after Excalidraw populates clipboardData,
//     our window-level bubble listener reads text/plain and pushes it to
//     the OS pasteboard (fire-and-forget).
//   - paste: intercept Cmd/Ctrl+V at capture phase, read the OS pasteboard
//     via the async bridge, then synthesize a ClipboardEvent('paste') with
//     a writable DataTransfer and dispatch it at document level so
//     Excalidraw's own paste handler processes the injected payload.
//
// On non-darwin platforms the bridge callbacks are absent; we install only
// the copy/cut mirror (which becomes a no-op) and skip the paste intercept,
// letting the webview's native paste proceed unchanged.
//
// TODO(image-paste): extending to image/binary pasteboard items requires a
// second pair of binds on the native side (dataForType:@"public.png") and
// base64 transport through webview.bind. See mac-pasteboard.ts.

type BridgeWindow = Window & {
  __excaliclaude_pb_read?: () => Promise<string>;
  __excaliclaude_pb_write?: (text: string) => Promise<boolean>;
  __excaliclaude_clipboard_installed?: boolean;
};

function getBridge(): BridgeWindow {
  return window as BridgeWindow;
}

// Minimal ExcalidrawAPI surface we need; kept structural to avoid a hard
// dependency on Excalidraw's type exports from this low-level module.
type MinimalExcalidrawAPI = {
  getSceneElements: () => readonly any[];
  getAppState: () => any;
  getFiles: () => any;
};

let registeredAPI: MinimalExcalidrawAPI | null = null;

export function registerExcalidrawAPIForClipboard(
  api: MinimalExcalidrawAPI | null,
): void {
  registeredAPI = api;
}

// Build the exact JSON payload Excalidraw expects on paste. The on-wire
// format is { type: "excalidraw/clipboard", elements, files } — see
// Excalidraw's clipboard.ts.
//
// Selection expansion: Excalidraw's internal copy walks `boundElements` of
// each selected shape to pull in bound text children (a text inside a
// rectangle is a separate `text` element with containerId pointing at the
// shape, linked via `boundElements: [{type:"text", id}]`). We replicate
// that so copying "rectangle with text inside" carries both elements,
// matching the built-in behavior.
function serializeSelectionForClipboard(): string | null {
  const api = registeredAPI;
  if (!api) return null;
  try {
    const appState = api.getAppState();
    const selectedIds: Record<string, true> = appState?.selectedElementIds ?? {};
    if (Object.keys(selectedIds).length === 0) return null;

    const allElements = api.getSceneElements();
    const byId = new Map<string, any>();
    for (const el of allElements) byId.set(el.id, el);

    const result = new Map<string, any>();
    for (const el of allElements) {
      if (selectedIds[el.id] && !el.isDeleted) result.set(el.id, el);
    }
    if (result.size === 0) return null;

    // Expand selection to include bound text children (text-in-container).
    const seeds = Array.from(result.values());
    for (const el of seeds) {
      const bound = (el as any).boundElements;
      if (!Array.isArray(bound)) continue;
      for (const b of bound) {
        if (!b || b.type !== 'text' || !b.id) continue;
        const child = byId.get(b.id);
        if (child && !child.isDeleted) result.set(child.id, child);
      }
    }

    const selected = Array.from(result.values());

    const files: Record<string, any> = {};
    try {
      const allFiles = api.getFiles() ?? {};
      for (const el of selected) {
        if (el?.type === 'image' && el.fileId && allFiles[el.fileId]) {
          files[el.fileId] = allFiles[el.fileId];
        }
      }
    } catch {
      /* best-effort */
    }

    return JSON.stringify({
      type: 'excalidraw/clipboard',
      elements: selected,
      files,
    });
  } catch (err) {
    console.error('[clipboard-bridge] serialize failed', err);
    return null;
  }
}

// Primary mirror path: intercept Cmd/Ctrl+C/X at keydown (before Excalidraw's
// own keyboard handler runs) and serialize the current selection directly
// via the registered excalidrawAPI. This bypasses both the clipboard event
// listener (which Excalidraw may stopPropagation on) and navigator.clipboard
// (which Excalidraw may not populate). The copy-event listener below is kept
// as a secondary path that catches text copies from inline text editors.
function handleCopyCutKeydown(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key !== 'c' && e.key !== 'C' && e.key !== 'x' && e.key !== 'X') return;
  if (e.defaultPrevented) return;

  const w = getBridge();
  if (typeof w.__excaliclaude_pb_write !== 'function') return;

  // We do NOT preventDefault here: Excalidraw must still run its own copy/cut
  // handler so intra-canvas paste keeps working and cut still deletes.
  const payload = serializeSelectionForClipboard();
  if (!payload) return;
  try {
    void w.__excaliclaude_pb_write(payload);
  } catch {
    /* swallow */
  }
}

function handleCopyOrCut(e: ClipboardEvent): void {
  try {
    const w = getBridge();
    if (typeof w.__excaliclaude_pb_write !== 'function') return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text.length === 0) return;
    void w.__excaliclaude_pb_write(text);
  } catch {
    /* swallow — never break the native copy path */
  }
}

async function handlePasteKeydown(e: KeyboardEvent): Promise<void> {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key !== 'v' && e.key !== 'V') return;
  if (e.defaultPrevented) return;

  const w = getBridge();
  const pbRead = w.__excaliclaude_pb_read;
  if (typeof pbRead !== 'function') return;

  e.preventDefault();
  e.stopImmediatePropagation();

  let text = '';
  try {
    text = (await pbRead()) ?? '';
  } catch (err) {
    console.error('[clipboard-bridge] pb_read failed', err);
    return;
  }

  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const evt = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });

    if (evt.clipboardData?.getData('text/plain') !== text) {
      console.warn(
        '[clipboard-bridge] ClipboardEvent ctor dropped clipboardData; OS→canvas paste degraded',
      );
      return;
    }

    const target = document.activeElement ?? document.body ?? document;
    target.dispatchEvent(evt);
  } catch (err) {
    console.error('[clipboard-bridge] paste synthesis failed', err);
  }
}

export function installClipboardBridge(): void {
  const w = getBridge();
  if (w.__excaliclaude_clipboard_installed) return;
  w.__excaliclaude_clipboard_installed = true;

  window.addEventListener('copy', handleCopyOrCut, { capture: false });
  window.addEventListener('cut', handleCopyOrCut, { capture: false });
  window.addEventListener('keydown', handleCopyCutKeydown, { capture: true });
  window.addEventListener(
    'keydown',
    (e) => void handlePasteKeydown(e),
    { capture: true },
  );
}

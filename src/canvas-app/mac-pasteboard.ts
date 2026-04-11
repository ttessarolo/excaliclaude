// macOS NSPasteboard bridge via Bun FFI / Objective-C runtime.
//
// Exposes UTF-8 plain-text read/write on the system general pasteboard.
// Called from canvas-bin.ts to wire two webview.bind() callbacks that
// synchronize the webview's internal WebKit clipboard with the OS
// pasteboard (see src/canvas-app/frontend/src/lib/clipboard-bridge.ts).
//
// Pattern mirrors mac-dock-icon.ts: dlopen libobjc with multiple
// objc_msgSend signatures (one per arity), register selectors, call
// through. Non-darwin platforms: no-op (return null / false).
//
// TODO: image support would require dataForType:@"public.png" →
// NSData → raw bytes, and a second pair of binds for binary payloads.

function nullTerminated(str: string): Uint8Array {
  return new TextEncoder().encode(str + '\0');
}

const UTI_UTF8_PLAIN_TEXT = 'public.utf8-plain-text';

// AppKit is normally loaded implicitly when Webview ctor initializes
// NSApplication. When this module is exercised standalone (e.g. from a
// smoke test before the webview exists), NSPasteboard class lookup fails
// because AppKit hasn't been linked yet. Force-load it once per process.
let appKitLoaded = false;
function ensureAppKitLoaded(dlopen: any, FFIType: any): void {
  if (appKitLoaded) return;
  try {
    // Bun FFI refuses an empty symbol map; declare any real AppKit C symbol
    // to force framework linkage. NSBeep is stable and has no side effects
    // until actually called.
    dlopen('/System/Library/Frameworks/AppKit.framework/AppKit', {
      NSBeep: { args: [], returns: FFIType.void },
    });
    appKitLoaded = true;
  } catch (err) {
    console.error(`[pasteboard] AppKit dlopen failed: ${err}`);
  }
}

export function readPasteboardString(): string | null {
  if (process.platform !== 'darwin') return null;

  let dlopen: any;
  let FFIType: any;
  let ptr: any;
  let CString: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffi = require('bun:ffi');
    dlopen = ffi.dlopen;
    FFIType = ffi.FFIType;
    ptr = ffi.ptr;
    CString = ffi.CString;
  } catch (err) {
    console.error(`[pasteboard] bun:ffi unavailable: ${err}`);
    return null;
  }

  try {
    ensureAppKitLoaded(dlopen, FFIType);
    const p = FFIType.pointer;
    const core = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_getClass: { args: [p], returns: p },
      sel_registerName: { args: [p], returns: p },
      objc_msgSend: { args: [p, p], returns: p },
    });
    const msg1 = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_msgSend: { args: [p, p, p], returns: p },
    });

    const getClass = (name: string) =>
      core.symbols.objc_getClass(ptr(nullTerminated(name)));
    const sel = (name: string) =>
      core.symbols.sel_registerName(ptr(nullTerminated(name)));

    const NSPasteboard = getClass('NSPasteboard');
    const NSString = getClass('NSString');
    if (!NSPasteboard || !NSString) {
      console.error('[pasteboard] NSPasteboard/NSString class lookup failed');
      return null;
    }

    const selGeneralPasteboard = sel('generalPasteboard');
    const selStringWithUTF8 = sel('stringWithUTF8String:');
    const selStringForType = sel('stringForType:');
    const selUTF8String = sel('UTF8String');

    const pb = core.symbols.objc_msgSend(NSPasteboard, selGeneralPasteboard);
    if (!pb) return null;

    const utiNS = msg1.symbols.objc_msgSend(
      NSString,
      selStringWithUTF8,
      ptr(nullTerminated(UTI_UTF8_PLAIN_TEXT)),
    );
    if (!utiNS) return null;

    const nsStr = msg1.symbols.objc_msgSend(pb, selStringForType, utiNS);
    if (!nsStr) return null;

    const cStrPtr = core.symbols.objc_msgSend(nsStr, selUTF8String);
    if (!cStrPtr) return null;

    return new CString(cStrPtr).toString();
  } catch (err) {
    console.error(`[pasteboard] read failed: ${err}`);
    return null;
  }
}

export function writePasteboardString(text: string): boolean {
  if (process.platform !== 'darwin') return false;

  let dlopen: any;
  let FFIType: any;
  let ptr: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffi = require('bun:ffi');
    dlopen = ffi.dlopen;
    FFIType = ffi.FFIType;
    ptr = ffi.ptr;
  } catch (err) {
    console.error(`[pasteboard] bun:ffi unavailable: ${err}`);
    return false;
  }

  try {
    ensureAppKitLoaded(dlopen, FFIType);
    const p = FFIType.pointer;
    const core = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_getClass: { args: [p], returns: p },
      sel_registerName: { args: [p], returns: p },
      objc_msgSend: { args: [p, p], returns: p },
    });
    const msg1 = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_msgSend: { args: [p, p, p], returns: p },
    });
    const msg2 = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_msgSend: { args: [p, p, p, p], returns: p },
    });

    const getClass = (name: string) =>
      core.symbols.objc_getClass(ptr(nullTerminated(name)));
    const sel = (name: string) =>
      core.symbols.sel_registerName(ptr(nullTerminated(name)));

    const NSPasteboard = getClass('NSPasteboard');
    const NSString = getClass('NSString');
    if (!NSPasteboard || !NSString) {
      console.error('[pasteboard] NSPasteboard/NSString class lookup failed');
      return false;
    }

    const selGeneralPasteboard = sel('generalPasteboard');
    const selStringWithUTF8 = sel('stringWithUTF8String:');
    const selClearContents = sel('clearContents');
    const selSetStringForType = sel('setString:forType:');

    const pb = core.symbols.objc_msgSend(NSPasteboard, selGeneralPasteboard);
    if (!pb) return false;

    core.symbols.objc_msgSend(pb, selClearContents);

    const payloadNS = msg1.symbols.objc_msgSend(
      NSString,
      selStringWithUTF8,
      ptr(nullTerminated(text ?? '')),
    );
    if (!payloadNS) return false;

    const typeNS = msg1.symbols.objc_msgSend(
      NSString,
      selStringWithUTF8,
      ptr(nullTerminated(UTI_UTF8_PLAIN_TEXT)),
    );
    if (!typeNS) return false;

    const okPtr = msg2.symbols.objc_msgSend(
      pb,
      selSetStringForType,
      payloadNS,
      typeNS,
    );
    // BOOL returned as NSInteger-sized value; nonzero = YES.
    return okPtr !== 0n && okPtr !== 0;
  } catch (err) {
    console.error(`[pasteboard] write failed: ${err}`);
    return false;
  }
}

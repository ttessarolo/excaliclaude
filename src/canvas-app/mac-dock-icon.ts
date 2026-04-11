// macOS dock icon + activation policy helper.
//
// When the canvas binary is spawned via exec() (not via LaunchServices), the
// child process inherits the terminal/parent dock icon instead of the one
// from the `.app` bundle. We patch this at runtime by calling AppKit via
// Bun FFI:
//   [NSApp setActivationPolicy: NSApplicationActivationPolicyRegular]
//   [NSApp setApplicationIconImage: [NSImage initWithContentsOfFile: path]]
//
// Must be called after the Webview ctor (which initializes NSApplication)
// but before webview.run() blocks the main thread.

import fs from 'fs';
import path from 'path';

const NSApplicationActivationPolicyRegular = 0;

function nullTerminated(str: string): Uint8Array {
  return new TextEncoder().encode(str + '\0');
}

/**
 * Locate `AppIcon.icns` near the executable. Two supported layouts:
 *   1) Raw binary (dev repo): `<dir>/AppIcon.icns` as sibling of execPath
 *   2) `.app` bundle: `<execDir>/../Resources/AppIcon.icns`
 * Returns the first match or null.
 */
function findBundledIcon(): string | null {
  try {
    const exec = process.execPath;
    const execDir = path.dirname(exec);
    const candidates = [
      path.join(execDir, 'AppIcon.icns'),
      path.resolve(execDir, '..', 'Resources', 'AppIcon.icns'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  } catch {
    return null;
  }
}

export function installMacDockIcon(): { ok: boolean; reason?: string } {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'not darwin' };
  }
  const iconPath = findBundledIcon();
  if (!iconPath) {
    return { ok: false, reason: 'icon not found alongside executable' };
  }

  // Bun FFI is only available under the Bun runtime (which is always true
  // for the compiled canvas-bin). Import dynamically so non-Bun toolchains
  // (tsc type-check, Vite) don't choke on the module.
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
    return { ok: false, reason: `bun:ffi unavailable: ${err}` };
  }

  try {
    const p = FFIType.pointer;
    // Same library, two bindings with different objc_msgSend signatures
    // (2-arg for no-arg methods, 3-arg for one-arg methods).
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

    const NSApplication = getClass('NSApplication');
    const NSImage = getClass('NSImage');
    const NSString = getClass('NSString');

    const selSharedApplication = sel('sharedApplication');
    const selAlloc = sel('alloc');
    const selStringWithUTF8 = sel('stringWithUTF8String:');
    const selInitWithContentsOfFile = sel('initWithContentsOfFile:');
    const selSetAppIcon = sel('setApplicationIconImage:');
    const selSetActivationPolicy = sel('setActivationPolicy:');
    const selActivateIgnoringOtherApps = sel('activateIgnoringOtherApps:');

    // NSApp = [NSApplication sharedApplication]
    const nsApp = core.symbols.objc_msgSend(NSApplication, selSharedApplication);
    if (!nsApp) return { ok: false, reason: 'NSApp is null' };

    // [NSApp setActivationPolicy: NSApplicationActivationPolicyRegular]
    // Pass the integer as a raw pointer value (calling convention is
    // identical on arm64 for int/pointer first arg).
    msg1.symbols.objc_msgSend(
      nsApp,
      selSetActivationPolicy,
      NSApplicationActivationPolicyRegular as unknown as bigint,
    );

    // NSString *nsPath = [NSString stringWithUTF8String: cstr]
    const nsPath = msg1.symbols.objc_msgSend(
      NSString,
      selStringWithUTF8,
      ptr(nullTerminated(iconPath)),
    );
    if (!nsPath) return { ok: false, reason: 'NSString alloc failed' };

    // NSImage *image = [[NSImage alloc] initWithContentsOfFile: nsPath]
    const imageAlloc = core.symbols.objc_msgSend(NSImage, selAlloc);
    const image = msg1.symbols.objc_msgSend(
      imageAlloc,
      selInitWithContentsOfFile,
      nsPath,
    );
    if (!image) return { ok: false, reason: 'NSImage load failed' };

    // [NSApp setApplicationIconImage: image]
    msg1.symbols.objc_msgSend(nsApp, selSetAppIcon, image);

    // [NSApp activateIgnoringOtherApps: YES]  — YES = 1
    msg1.symbols.objc_msgSend(
      nsApp,
      selActivateIgnoringOtherApps,
      1 as unknown as bigint,
    );

    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `FFI call failed: ${err}` };
  }
}

#!/usr/bin/env node
// Orchestratore: vite build → generate-embedded-frontend → bun build --compile.
// Default target = platform corrente. Override con `--target bun-<os>-<arch>`.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function currentTarget(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin' && a === 'arm64') return 'bun-darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'bun-darwin-x64';
  if (p === 'linux' && a === 'arm64') return 'bun-linux-arm64';
  if (p === 'linux' && a === 'x64') return 'bun-linux-x64';
  if (p === 'win32' && a === 'x64') return 'bun-windows-x64';
  throw new Error(`Unsupported platform: ${p}-${a}`);
}

function run(cmd: string): void {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
}

function which(bin: string): string | null {
  const candidates = [
    `${process.env.HOME}/.bun/bin/${bin}`,
    `/usr/local/bin/${bin}`,
    `/opt/homebrew/bin/${bin}`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    return execSync(`command -v ${bin}`, { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const APP_NAME = 'ExcaliClaude';
const APP_BUNDLE_ID = 'dev.excaliclaude.canvas';

function ensureIcon(): string | null {
  const icns = path.join(PROJECT_ROOT, 'assets', 'icon', 'icon.icns');
  if (fs.existsSync(icns)) return icns;
  console.log('[build-bin] icon missing — generating');
  try {
    run('npx tsx scripts/generate-icon.ts');
  } catch (err) {
    console.warn('[build-bin] icon generation failed:', err);
    return null;
  }
  return fs.existsSync(icns) ? icns : null;
}

function writeInfoPlist(
  contentsDir: string,
  executableName: string,
  iconFileName: string,
): void {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${executableName}</string>
  <key>CFBundleIconFile</key>
  <string>${iconFileName}</string>
  <key>CFBundleIdentifier</key>
  <string>${APP_BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPasteboardUsageDescription</key>
  <string>ExcaliClaude syncs copy and paste between the canvas and other apps.</string>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), plist);
}

function wrapDarwinBundle(
  rawBinary: string,
  suffix: string,
  outDir: string,
): string {
  // Wrap the compiled binary into a `.app` bundle so macOS gives it a proper
  // dock icon instead of inheriting the terminal/parent-process icon.
  const appName = `${APP_NAME}-${suffix}.app`;
  const appDir = path.join(outDir, appName);
  const contentsDir = path.join(appDir, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const executableName = APP_NAME.toLowerCase();
  const bundledBinary = path.join(macosDir, executableName);
  fs.copyFileSync(rawBinary, bundledBinary);
  fs.chmodSync(bundledBinary, 0o755);

  const icnsSrc = ensureIcon();
  const iconFileName = 'AppIcon.icns';
  if (icnsSrc) {
    fs.copyFileSync(icnsSrc, path.join(resourcesDir, iconFileName));
  }

  writeInfoPlist(contentsDir, executableName, iconFileName.replace(/\.icns$/, ''));
  // Re-sign the bundled binary so Gatekeeper is happy with its new location.
  try {
    execSync(`codesign --remove-signature "${bundledBinary}"`, { stdio: 'ignore' });
  } catch {}
  run(
    `codesign --force --sign - --identifier ${APP_BUNDLE_ID} "${bundledBinary}"`,
  );
  return bundledBinary;
}

function main(): void {
  const target = arg('--target') || currentTarget();
  const suffix = target.replace(/^bun-/, '');
  const outDir = path.join(PROJECT_ROOT, 'dist', 'bin');
  const outFile = path.join(
    outDir,
    `canvas-${suffix}${target.includes('windows') ? '.exe' : ''}`,
  );

  const bunBin = which('bun');
  if (!bunBin) {
    console.error('ERROR: bun not found. Install via https://bun.sh');
    process.exit(1);
  }

  console.log(`[build-bin] target=${target}`);
  console.log(`[build-bin] bun=${bunBin}`);
  console.log(`[build-bin] out=${path.relative(PROJECT_ROOT, outFile)}`);

  run('npm run build:frontend');
  run('npm run gen:embedded');

  fs.mkdirSync(outDir, { recursive: true });
  const entry = path.join('src', 'canvas-app', 'canvas-bin.ts');
  const flags = [
    'build',
    '--compile',
    '--minify',
    '--sourcemap',
    `--target=${target}`,
    entry,
    '--outfile',
    outFile,
  ];
  run(`${bunBin} ${flags.join(' ')}`);

  if (target.startsWith('bun-darwin')) {
    try {
      execSync(`codesign --remove-signature "${outFile}"`, { stdio: 'ignore' });
    } catch {}
    run(`codesign --force --sign - --identifier excaliclaude.canvas "${outFile}"`);

    // Also copy AppIcon.icns alongside the raw binary so the runtime FFI
    // helper can pick it up even when the MCP server spawns the raw binary
    // (i.e. without going through the .app bundle path).
    const icnsSrc = ensureIcon();
    if (icnsSrc) {
      fs.copyFileSync(icnsSrc, path.join(outDir, 'AppIcon.icns'));
      console.log(
        `[build-bin] copied AppIcon.icns to ${path.relative(PROJECT_ROOT, outDir)}`,
      );
    }

    const bundled = wrapDarwinBundle(outFile, suffix, outDir);
    console.log(
      `\n✓ Built .app bundle at ${path.relative(PROJECT_ROOT, path.dirname(path.dirname(bundled)))}`,
    );
  }

  const stat = fs.statSync(outFile);
  console.log(`\n✓ Built ${outFile} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main();

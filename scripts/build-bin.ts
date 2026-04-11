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

  const stat = fs.statSync(outFile);
  console.log(`\n✓ Built ${outFile} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main();

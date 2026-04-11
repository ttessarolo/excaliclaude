#!/usr/bin/env node
// Generate the ExcaliClaude app icon from `assets/icon/source.png`.
//
// Pipeline:
//   1. Load source PNG (any square size; recommended ≥1024).
//   2. Flood-fill near-white pixels starting from the four corners so the
//      rounded-rect background ends with a fully transparent outside.
//   3. Write master `assets/icon/icon.png` (1024×1024).
//   4. On macOS, render the required iconset sizes via `sips` and call
//      `iconutil` to produce `assets/icon/icon.icns`.
//
// The flood-fill approach preserves the white highlight inside the artwork
// (it only clears pixels connected to the corners), which a simple
// "white → transparent" replace would incorrectly wipe.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const WHITE_THRESHOLD = 235;

function isNearWhite(r: number, g: number, b: number, a: number): boolean {
  if (a < 8) return true;
  return r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD;
}

function floodFillCornersTransparent(png: PNG): void {
  const { width, height, data } = png;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];

  const seeds: Array<[number, number]> = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  for (const [sx, sy] of seeds) stack.push(sy * width + sx);

  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const idx = p << 2;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (!isNearWhite(r, g, b, a)) continue;
    data[idx + 3] = 0;

    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
  }

  // Soften the jagged mask edge by fading pixels that neighbour transparency.
  const softened = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) << 2;
      if (data[idx + 3] === 0) continue;
      let transparentNeighbours = 0;
      let total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          total++;
          if (data[((ny * width + nx) << 2) + 3] === 0) transparentNeighbours++;
        }
      }
      if (transparentNeighbours > 0 && total > 0) {
        const frac = transparentNeighbours / total;
        const alpha = Math.max(0, Math.min(255, Math.round(255 * (1 - frac * 0.6))));
        softened[y * width + x] = alpha;
      } else {
        softened[y * width + x] = data[idx + 3];
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    const a = softened[i];
    if (a !== 0) data[(i << 2) + 3] = a;
  }
}

function loadPng(filePath: string): PNG {
  const buf = fs.readFileSync(filePath);
  return PNG.sync.read(buf);
}

function savePng(png: PNG, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function buildIcns(masterPngPath: string, outIcnsPath: string): boolean {
  if (process.platform !== 'darwin') return false;
  const iconset = outIcnsPath.replace(/\.icns$/, '.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  const sizes: Array<{ size: number; name: string }> = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];
  for (const { size, name } of sizes) {
    const out = path.join(iconset, name);
    execSync(
      `/usr/bin/sips -z ${size} ${size} "${masterPngPath}" --out "${out}"`,
      { stdio: 'ignore' },
    );
  }

  try {
    execSync(`/usr/bin/iconutil -c icns "${iconset}" -o "${outIcnsPath}"`, {
      stdio: 'inherit',
    });
    fs.rmSync(iconset, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error('[generate-icon] iconutil failed:', err);
    return false;
  }
}

function main(): void {
  const assetsDir = path.join(PROJECT_ROOT, 'assets', 'icon');
  const sourcePath = path.join(assetsDir, 'source.png');
  const pngPath = path.join(assetsDir, 'icon.png');
  const icnsPath = path.join(assetsDir, 'icon.icns');

  if (!fs.existsSync(sourcePath)) {
    console.error(`[generate-icon] missing ${path.relative(PROJECT_ROOT, sourcePath)}`);
    process.exit(1);
  }

  console.log('[generate-icon] loading source PNG');
  const png = loadPng(sourcePath);
  console.log(`[generate-icon] ${png.width}×${png.height}, flooding corners to transparent`);
  floodFillCornersTransparent(png);

  savePng(png, pngPath);
  console.log(`[generate-icon] wrote ${path.relative(PROJECT_ROOT, pngPath)}`);

  if (buildIcns(pngPath, icnsPath)) {
    console.log(`[generate-icon] wrote ${path.relative(PROJECT_ROOT, icnsPath)}`);
  } else {
    console.log('[generate-icon] skipped .icns (non-macOS or iconutil error)');
  }
}

main();

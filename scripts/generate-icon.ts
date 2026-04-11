#!/usr/bin/env node
// Generate a temporary ExcaliClaude app icon (1024×1024 PNG + .icns).
//
// Design: rounded square, purple gradient (#7C5CFC → #4c3a9e), with a white
// stylized "X" mark. Zero external assets — fully procedural so this runs
// anywhere without needing an SVG/PNG source in the repo. Swap with a real
// icon whenever we have time to design one.
//
// Output:
//   assets/icon/icon.png
//   assets/icon/icon.icns  (only on macOS, via /usr/bin/iconutil)

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Signed distance from point (px,py) to rounded rect at origin. */
function sdfRoundedRect(
  px: number,
  py: number,
  size: number,
  radius: number,
): number {
  const half = size / 2;
  const dx = Math.abs(px - half) - (half - radius);
  const dy = Math.abs(py - half) - (half - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - radius;
}

/** Distance from point to line segment. */
function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function renderIcon(size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const top = hexToRgb('#7C5CFC');
  const bottom = hexToRgb('#4C3A9E');
  const white = { r: 255, g: 255, b: 255 };
  const radius = size * 0.22;
  const margin = size * 0.08;
  const inner = size - margin * 2;

  // Bold "X" geometry: two diagonals with stroke width ~size/10.
  const strokeW = size * 0.11;
  const x1 = margin + inner * 0.18;
  const y1 = margin + inner * 0.18;
  const x2 = margin + inner * 0.82;
  const y2 = margin + inner * 0.82;
  const x3 = margin + inner * 0.82;
  const y3 = margin + inner * 0.18;
  const x4 = margin + inner * 0.18;
  const y4 = margin + inner * 0.82;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) << 2;

      // Rounded rect mask (with 1.5 px antialiasing).
      const sdf = sdfRoundedRect(x + 0.5, y + 0.5, size, radius);
      const rectAlpha = Math.max(0, Math.min(1, 0.5 - sdf));
      if (rectAlpha <= 0) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      // Gradient fill (top → bottom).
      const t = y / (size - 1);
      let r = lerp(top.r, bottom.r, t);
      let g = lerp(top.g, bottom.g, t);
      let b = lerp(top.b, bottom.b, t);

      // Diagonal cross mask: min distance to either diagonal segment.
      const d1 = distToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2);
      const d2 = distToSegment(x + 0.5, y + 0.5, x3, y3, x4, y4);
      const dMin = Math.min(d1, d2);
      const stroke = Math.max(0, Math.min(1, (strokeW * 0.5 - dMin) / 1.2));
      if (stroke > 0) {
        r = lerp(r, white.r, stroke);
        g = lerp(g, white.g, stroke);
        b = lerp(b, white.b, stroke);
      }

      png.data[idx] = Math.round(r);
      png.data[idx + 1] = Math.round(g);
      png.data[idx + 2] = Math.round(b);
      png.data[idx + 3] = Math.round(rectAlpha * 255);
    }
  }

  return PNG.sync.write(png);
}

function writePng(buffer: Buffer, out: string): void {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buffer);
}

function buildIcns(masterPngPath: string, outIcnsPath: string): boolean {
  // macOS only: build an iconset with required sizes and run iconutil.
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
    fs.writeFileSync(path.join(iconset, name), renderIcon(size));
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
  const pngPath = path.join(assetsDir, 'icon.png');
  const icnsPath = path.join(assetsDir, 'icon.icns');

  console.log('[generate-icon] rendering 1024×1024 master PNG');
  writePng(renderIcon(1024), pngPath);
  console.log(`[generate-icon] wrote ${path.relative(PROJECT_ROOT, pngPath)}`);

  if (buildIcns(pngPath, icnsPath)) {
    console.log(
      `[generate-icon] wrote ${path.relative(PROJECT_ROOT, icnsPath)}`,
    );
  } else {
    console.log('[generate-icon] skipped .icns (non-macOS or iconutil error)');
  }
}

main();

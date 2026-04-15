#!/usr/bin/env tsx
// Release helper: bump version, commit, tag, push.
// Usage: pnpm release "<message>" [--dry-run] [--skip-build]
//   Message prefix determines bump:
//     "fix: ..."   → patch
//     "minor: ..." → minor
//     "major: ..." → major
//   Legacy: pnpm release [patch|minor|major] still works (uses default commit message).

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

type Bump = 'patch' | 'minor' | 'major';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipBuild = args.includes('--skip-build');
const positional = args.filter((a) => !a.startsWith('--'));
const firstArg = positional[0];

let bump: Bump;
let message: string | null = null;

if (firstArg && ['patch', 'minor', 'major'].includes(firstArg)) {
  bump = firstArg as Bump;
} else if (firstArg) {
  const m = firstArg.match(/^(fix|minor|major)\s*:\s*(.+)$/i);
  if (m) {
    const prefix = m[1].toLowerCase();
    bump = prefix === 'fix' ? 'patch' : (prefix as Bump);
  } else {
    bump = 'patch';
  }
  message = firstArg.trim();
} else {
  console.error('Missing message. Usage: pnpm release "fix: ..." | "minor: ..." | "major: ..."');
  process.exit(1);
}

function sh(cmd: string, opts: { capture?: boolean } = {}): string {
  console.log(`$ ${cmd}`);
  if (dryRun && !opts.capture && !/^git (status|rev-parse|branch|pull)/.test(cmd)) {
    return '';
  }
  return execSync(cmd, {
    cwd: ROOT,
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  }) as unknown as string;
}

function bumpSemver(version: string, kind: Bump): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) throw new Error(`Unparseable version: ${version}`);
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === 'major') { maj++; min = 0; pat = 0; }
  else if (kind === 'minor') { min++; pat = 0; }
  else pat++;
  return `${maj}.${min}.${pat}`;
}

function updateJsonVersion(file: string, newVersion: string): boolean {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return false;
  const raw = fs.readFileSync(full, 'utf8');
  const json = JSON.parse(raw);
  if (typeof json.version !== 'string') return false;
  json.version = newVersion;
  const indented = JSON.stringify(json, null, 2) + (raw.endsWith('\n') ? '\n' : '');
  if (!dryRun) fs.writeFileSync(full, indented);
  console.log(`  updated ${file} → ${newVersion}`);
  return true;
}

// 1. Pre-checks
const branch = sh('git rev-parse --abbrev-ref HEAD', { capture: true }).trim();
if (branch !== 'main') {
  console.error(`Must be on main (current: ${branch}).`);
  process.exit(1);
}

sh('git pull --ff-only');

const preStatus = sh('git status --porcelain', { capture: true }).trim();
const hasPending = preStatus.length > 0;
if (hasPending) {
  console.log('\nPending changes detected — will be included in release commit:');
  console.log(preStatus);
}

// 2. Bump
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current: string = pkg.version;
const next = bumpSemver(current, bump);
console.log(`\n→ ${current}  ⇒  ${next}  (${bump})\n`);

updateJsonVersion('package.json', next);
updateJsonVersion('.claude-plugin/plugin.json', next);

// 3. Sanity build
if (!skipBuild) {
  sh('pnpm run build');
}

// 4. Commit + tag
if (hasPending) {
  sh('git add -A');
} else {
  const files = ['package.json', '.claude-plugin/plugin.json'];
  sh(`git add ${files.join(' ')}`);
}
const commitMsg = message
  ? `${message}\n\nchore(release): v${next}`
  : `chore(release): v${next}`;
sh(`git commit -m ${JSON.stringify(commitMsg)}`);
sh(`git tag -a v${next} -m "Release v${next}"`);

// 5. Push
sh('git push origin main --follow-tags');

console.log(`\n✓ Released v${next}`);
console.log(`  Monitor CI: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo OWNER/REPO)/actions`);
console.log(`  Release page will be populated once workflow completes.`);

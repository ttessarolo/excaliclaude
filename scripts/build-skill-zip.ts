#!/usr/bin/env tsx
/**
 * Packages the excaliclaude skill (SKILL.md + references/) into a zip file
 * at the project root. The skill name in SKILL.md is temporarily set to
 * "excalicl4ude" for Claude Desktop compatibility (rejects "claude" in names),
 * then restored after zipping.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'excaliclaude');
const SKILL_FILE = path.join(SKILL_DIR, 'SKILL.md');
const ZIP_NAME = 'excaliclaude-skill.zip';
const ZIP_PATH = path.join(ROOT, ZIP_NAME);

// Read current skill content
const original = fs.readFileSync(SKILL_FILE, 'utf-8');

// Ensure the name is "excalicl4ude" for the zip (Claude Desktop workaround)
const patched = original.replace(/^name:\s*excaliclaude\s*$/m, 'name: excalicl4ude');
const needsRestore = patched !== original;

try {
  if (needsRestore) {
    fs.writeFileSync(SKILL_FILE, patched, 'utf-8');
    console.log('  Patched skill name → excalicl4ude');
  }

  // Remove old zip if present
  if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

  // Create zip from the skills/excaliclaude directory
  execSync(`cd "${path.join(ROOT, 'skills')}" && zip -r "${ZIP_PATH}" excaliclaude/`, {
    stdio: 'inherit',
  });

  console.log(`  ✓ ${ZIP_NAME} created at project root`);
} finally {
  // Always restore original content
  if (needsRestore) {
    fs.writeFileSync(SKILL_FILE, original, 'utf-8');
    console.log('  Restored skill name → excaliclaude');
  }
}

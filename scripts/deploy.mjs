#!/usr/bin/env node
/**
 * Deploy script: bumps fork version, builds, and copies plugin to Obsidian vault.
 *
 * Usage:
 *   node scripts/deploy.mjs          # bump patch (fork.2 → fork.3)
 *   node scripts/deploy.mjs --skip-bump  # build + copy without version bump
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MANIFEST_PATH = join(ROOT, 'manifest.json');
const FILES_TO_COPY = ['main.js', 'manifest.json', 'styles.css'];

// ---------------------------------------------------------------------------
// 1. Resolve vault path
// ---------------------------------------------------------------------------

function loadEnvLocal() {
  const envPath = join(ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2];
    }
  }
}

loadEnvLocal();

const vaultPath = process.env.OBSIDIAN_VAULT;
if (!vaultPath || !existsSync(vaultPath)) {
  console.error('OBSIDIAN_VAULT not set or path does not exist.');
  console.error('Set it in .env.local: OBSIDIAN_VAULT=/path/to/your/vault');
  process.exit(1);
}

const pluginDir = join(vaultPath, '.obsidian', 'plugins', 'claudian');

// ---------------------------------------------------------------------------
// 2. Bump fork version
// ---------------------------------------------------------------------------

const skipBump = process.argv.includes('--skip-bump');

if (!skipBump) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const version = manifest.version;

  // Parse: 1.3.64-fork.2 → { base: "1.3.64", fork: 2 }
  const forkMatch = version.match(/^(.+)-fork\.(\d+)$/);
  if (forkMatch) {
    const newFork = parseInt(forkMatch[2], 10) + 1;
    manifest.version = `${forkMatch[1]}-fork.${newFork}`;
  } else {
    // First fork version from a base like "1.3.64"
    manifest.version = `${version}-fork.1`;
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Version bumped to ${manifest.version}`);
}

// ---------------------------------------------------------------------------
// 3. Build
// ---------------------------------------------------------------------------

console.log('Building...');
execSync('node scripts/build.mjs production', { cwd: ROOT, stdio: 'inherit' });

// ---------------------------------------------------------------------------
// 4. Copy to vault
// ---------------------------------------------------------------------------

if (!existsSync(pluginDir)) {
  mkdirSync(pluginDir, { recursive: true });
}

for (const file of FILES_TO_COPY) {
  const src = join(ROOT, file);
  if (existsSync(src)) {
    copyFileSync(src, join(pluginDir, file));
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
console.log(`Deployed v${manifest.version} to ${pluginDir}`);

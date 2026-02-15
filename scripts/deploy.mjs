#!/usr/bin/env node
/**
 * Deploy script: bumps fork version, builds, and copies plugin to Obsidian vault.
 *
 * Usage:
 *   node scripts/deploy.mjs              # bump, build, copy, commit, push all remotes
 *   node scripts/deploy.mjs --skip-bump  # build + copy + push without version bump
 *   node scripts/deploy.mjs --skip-git   # bump + build + copy only (no commit/push)
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

// ---------------------------------------------------------------------------
// 5. Git commit + push to all remotes
// ---------------------------------------------------------------------------

const skipGit = process.argv.includes('--skip-git');

if (!skipGit) {
  // Stage version bump (manifest.json changed by step 2)
  try {
    const status = execSync('git status --porcelain manifest.json', { cwd: ROOT, encoding: 'utf-8' }).trim();
    if (status) {
      execSync('git add manifest.json', { cwd: ROOT, stdio: 'inherit' });
      execSync(
        `git commit -m "chore: bump version to ${manifest.version}"`,
        { cwd: ROOT, stdio: 'inherit' },
      );
    }
  } catch {
    // Nothing to commit — fine
  }

  // Push to all remotes
  const remotesRaw = execSync('git remote', { cwd: ROOT, encoding: 'utf-8' }).trim();
  const remotes = remotesRaw.split('\n').filter(Boolean);

  for (const remote of remotes) {
    // Skip upstream (original repo, read-only)
    if (remote === 'upstream') continue;
    try {
      console.log(`Pushing to ${remote}...`);
      execSync(`git push ${remote} main`, { cwd: ROOT, stdio: 'inherit' });
    } catch {
      console.error(`Failed to push to ${remote} (continuing)`);
    }
  }
}

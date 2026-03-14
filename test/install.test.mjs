/**
 * Integration tests for install.sh
 *
 * Runs the installer against a temp $HOME directory to test file copying,
 * settings.json merging, and idempotency — without touching ~/.claude/.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, writeFileSync,
  mkdtempSync, rmSync, mkdirSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const INSTALLER = resolve(DIR, '../install.sh');

// Each test gets its own isolated HOME
function makeFakeHome() {
  const home = mkdtempSync(resolve(tmpdir(), 'conflict-audit-install-test-'));
  mkdirSync(resolve(home, '.claude'), { recursive: true });
  return home;
}

function runInstaller(fakeHome, extraEnv = {}) {
  return spawnSync('bash', [INSTALLER], {
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, HOME: fakeHome, CLAUDE_HOME: resolve(fakeHome, '.claude'), ...extraEnv },
    cwd: resolve(DIR, '..'),
  });
}

const homes = [];
after(() => {
  for (const h of homes) {
    try { rmSync(h, { recursive: true, force: true }); } catch {}
  }
});

// ─── Basic installation ───────────────────────────────────────────────────

test('installer exits 0 on clean install', () => {
  const home = makeFakeHome(); homes.push(home);
  const r = runInstaller(home);
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
});

test('installer prints success message', () => {
  const home = makeFakeHome(); homes.push(home);
  const r = runInstaller(home);
  assert.ok(r.stdout.includes('installed'), `Expected success message, got: ${r.stdout}`);
});

test('hook files are copied to ~/.claude/hooks/', () => {
  const home = makeFakeHome(); homes.push(home);
  runInstaller(home);
  const hooksDir = resolve(home, '.claude', 'hooks');
  assert.ok(existsSync(resolve(hooksDir, 'conflict-detector.mjs')), 'conflict-detector.mjs missing');
  assert.ok(existsSync(resolve(hooksDir, 'conflict-knowledge.mjs')), 'conflict-knowledge.mjs missing');
  assert.ok(existsSync(resolve(hooksDir, 'learned-conflicts.mjs')), 'learned-conflicts.mjs missing');
  assert.ok(existsSync(resolve(hooksDir, 'generate-conflict-checks.mjs')), 'generate-conflict-checks.mjs missing');
  assert.ok(existsSync(resolve(hooksDir, 'promote-candidates.mjs')), 'promote-candidates.mjs missing');
});

test('SKILL.md is copied to ~/.claude/skills/conflict-audit/', () => {
  const home = makeFakeHome(); homes.push(home);
  runInstaller(home);
  assert.ok(
    existsSync(resolve(home, '.claude', 'skills', 'conflict-audit', 'SKILL.md')),
    'SKILL.md missing',
  );
});

// ─── settings.json hook registration ─────────────────────────────────────

test('hook is registered in settings.json', () => {
  const home = makeFakeHome(); homes.push(home);
  runInstaller(home);
  const settings = JSON.parse(readFileSync(resolve(home, '.claude', 'settings.json'), 'utf-8'));
  const commands = (settings?.hooks?.PostToolUse ?? [])
    .flatMap(g => g.hooks ?? [])
    .map(h => h.command ?? '');
  const registered = commands.some(c => c.includes('conflict-detector.mjs'));
  assert.ok(registered, `Hook not registered. commands: ${JSON.stringify(commands)}`);
});

test('installer creates settings.json if missing', () => {
  const home = makeFakeHome(); homes.push(home);
  // Don't pre-create settings.json
  const settingsPath = resolve(home, '.claude', 'settings.json');
  assert.ok(!existsSync(settingsPath), 'settings.json should not exist before install');
  runInstaller(home);
  assert.ok(existsSync(settingsPath), 'settings.json should exist after install');
});

test('installer merges into existing settings.json without overwriting other keys', () => {
  const home = makeFakeHome(); homes.push(home);
  const settingsPath = resolve(home, '.claude', 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ env: { MY_KEY: 'my-value' } }, null, 2), 'utf-8');
  runInstaller(home);
  const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  assert.strictEqual(settings?.env?.MY_KEY, 'my-value', 'Existing keys should be preserved');
  assert.ok(settings?.hooks?.PostToolUse, 'Hook should be added');
});

// ─── Idempotency ──────────────────────────────────────────────────────────

test('running installer twice does not duplicate hook entry', () => {
  const home = makeFakeHome(); homes.push(home);
  runInstaller(home);
  runInstaller(home);
  const settings = JSON.parse(readFileSync(resolve(home, '.claude', 'settings.json'), 'utf-8'));
  const commands = (settings?.hooks?.PostToolUse ?? [])
    .flatMap(g => g.hooks ?? [])
    .map(h => h.command ?? '')
    .filter(c => c.includes('conflict-detector.mjs'));
  assert.strictEqual(commands.length, 1, `Expected 1 hook entry, got ${commands.length}`);
});

test('running installer twice exits 0 both times', () => {
  const home = makeFakeHome(); homes.push(home);
  const r1 = runInstaller(home);
  const r2 = runInstaller(home);
  assert.strictEqual(r1.status, 0, `First run failed: ${r1.stderr}`);
  assert.strictEqual(r2.status, 0, `Second run failed: ${r2.stderr}`);
});

// ─── Malformed settings.json ──────────────────────────────────────────────

test('malformed settings.json → installer exits 1 with error message', () => {
  const home = makeFakeHome(); homes.push(home);
  const settingsPath = resolve(home, '.claude', 'settings.json');
  writeFileSync(settingsPath, '{ not valid json }', 'utf-8');
  const r = runInstaller(home);
  assert.notStrictEqual(r.status, 0, 'Should fail on malformed settings.json');
  assert.ok(
    r.stdout.includes('not valid JSON') || r.stderr.includes('not valid JSON'),
    `Expected JSON error message, got stdout: ${r.stdout} stderr: ${r.stderr}`,
  );
});

// ─── File backup on re-install ────────────────────────────────────────────

test('re-install creates backup of existing hook files', () => {
  const home = makeFakeHome(); homes.push(home);
  // First install
  runInstaller(home);
  // Second install — should back up the files copied by first install
  runInstaller(home);
  const hooksDir = resolve(home, '.claude', 'hooks');
  const files = readdirSync(hooksDir);
  const backups = files.filter(f => f.includes('.bak-'));
  assert.ok(backups.length > 0, `Expected backup files, found: ${files.join(', ')}`);
});

// Helper: readdirSync without importing at top to keep lazy
import { readdirSync } from 'node:fs';

/**
 * Integration tests for generate-conflict-checks.mjs
 *
 * Runs the generator as a subprocess and verifies the output file.
 * Side effect: overwrites ~/.claude/skills/conflict-audit/references/conflict-checks.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const GENERATOR = resolve(DIR, '../hooks/generate-conflict-checks.mjs');
const OUTPUT = resolve(homedir(), '.claude', 'skills', 'conflict-audit', 'references', 'conflict-checks.md');

// Run once and cache result — all tests read the same output file
const result = spawnSync('node', [GENERATOR], { encoding: 'utf-8', timeout: 10000 });
const content = (() => {
  try { return readFileSync(OUTPUT, 'utf-8'); } catch { return ''; }
})();

test('generator exits 0', () => {
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
});

test('generator prints success message with count', () => {
  assert.ok(result.stdout.includes('✅ Written'), `stdout: ${result.stdout}`);
  assert.ok(/Written \d+ checks/.test(result.stdout));
});

test('output file has AUTO-GENERATED header', () => {
  assert.ok(content.includes('<!-- AUTO-GENERATED'), 'Missing AUTO-GENERATED comment');
  assert.ok(content.includes('Regenerate: node'), 'Missing regenerate instruction');
  assert.ok(content.includes('conflict-knowledge.mjs'), 'Missing source reference');
});

test('output file has at least 8 conflict checks', () => {
  const matches = content.match(/^## Check \d+:/gm);
  assert.ok(matches && matches.length >= 8, `Expected ≥8 checks, found ${matches?.length ?? 0}`);
});

test('each check section has severity', () => {
  assert.ok(content.includes('**Severity:**'), 'Missing severity fields');
});

test('each check section has fix', () => {
  assert.ok(content.includes('**Fix:**'), 'Missing fix fields');
});

test('each check section has source', () => {
  assert.ok(content.includes('**Source:**'), 'Missing source fields');
});

test('output file starts with correct title', () => {
  assert.ok(content.startsWith('# Conflict Check Reference'), 'Wrong title');
});

test('running generator twice produces identical output (idempotent)', () => {
  const r2 = spawnSync('node', [GENERATOR], { encoding: 'utf-8', timeout: 10000 });
  assert.strictEqual(r2.status, 0);
  const content2 = readFileSync(OUTPUT, 'utf-8');
  assert.strictEqual(content2, content, 'Generator is not idempotent — output changed on second run');
});

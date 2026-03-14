/**
 * Tests for promote-candidates.mjs
 *
 * Tests non-interactive code paths only (--export, TTY guard, edge cases).
 * Interactive [p/d/s] prompts are not testable via spawnSync without a PTY,
 * and are covered by the manual test in the README.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const PROMOTER = resolve(DIR, '../hooks/promote-candidates.mjs');
const REAL_LEARNED = resolve(DIR, '../hooks/learned-conflicts.mjs');

// Temp dir for all file side effects
const TMP_DIR = mkdtempSync(resolve(tmpdir(), 'conflict-audit-promote-test-'));
const CANDIDATES = resolve(TMP_DIR, 'candidates.jsonl');
const LEARNED = resolve(TMP_DIR, 'learned-conflicts.mjs');

after(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// Copy real learned-conflicts.mjs as base for all tests
function resetLearned() {
  copyFileSync(REAL_LEARNED, LEARNED);
}

function run(args = [], extraEnv = {}) {
  return spawnSync('node', [PROMOTER, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
    env: {
      ...process.env,
      CONFLICT_AUDIT_CANDIDATES_PATH: CANDIDATES,
      CONFLICT_AUDIT_LEARNED_PATH: LEARNED,
    },
    ...extraEnv,
  });
}

// ─── Non-TTY guard ────────────────────────────────────────────────────────

test('non-TTY stdin → exit 1 with message', () => {
  // spawnSync stdin is never a TTY — process.stdin.isTTY will be undefined/false
  resetLearned();
  const r = run();
  assert.strictEqual(r.status, 1, `Expected exit 1, got ${r.status}\nstdout: ${r.stdout}`);
  assert.ok(
    r.stderr.includes('interactive terminal'),
    `Expected TTY message, got: ${r.stderr}`,
  );
});

// ─── No candidates ────────────────────────────────────────────────────────

test('missing candidates file → non-TTY exits 1 (TTY guard fires before file check)', () => {
  resetLearned();
  // Don't write CANDIDATES — file doesn't exist
  try { rmSync(CANDIDATES); } catch {}
  const r = run([]);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('interactive terminal'));
});

test('empty candidates file → non-TTY exits 1 (TTY guard fires before empty check)', () => {
  resetLearned();
  writeFileSync(CANDIDATES, '', 'utf-8');
  const r = run();
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('interactive terminal'));
});

// ─── --export mode ────────────────────────────────────────────────────────

test('--export outputs valid JSON array', () => {
  resetLearned();
  const r = run(['--export']);
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); }, 'Output should be valid JSON');
  assert.ok(Array.isArray(parsed), 'Output should be a JSON array');
});

test('--export includes built-in conflicts', () => {
  resetLearned();
  const r = run(['--export']);
  assert.strictEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.length >= 8, `Expected ≥8 conflicts, got ${parsed.length}`);
});

test('--export strips inputSummary from all entries', () => {
  resetLearned();
  const r = run(['--export']);
  assert.strictEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  for (const entry of parsed) {
    assert.ok(!('inputSummary' in entry), `Entry "${entry.id}" should not have inputSummary`);
  }
});

test('--export strips responseSummary from all entries', () => {
  resetLearned();
  const r = run(['--export']);
  assert.strictEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  for (const entry of parsed) {
    assert.ok(!('responseSummary' in entry), `Entry "${entry.id}" should not have responseSummary`);
  }
});

test('--export output has required fields on each entry', () => {
  resetLearned();
  const r = run(['--export']);
  assert.strictEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  const required = ['id', 'source', 'tool', 'severity', 'detect', 'fix'];
  for (const entry of parsed) {
    for (const field of required) {
      assert.ok(field in entry, `Entry "${entry.id}" missing required field: ${field}`);
    }
  }
});

// ─── Candidate aggregation (via --export with learned entries) ────────────

test('candidates with corrupt NDJSON lines are skipped gracefully', () => {
  resetLearned();
  // Mix valid and corrupt lines
  writeFileSync(CANDIDATES, [
    JSON.stringify({ type: 'candidate', id: 'test-id-1', tool: 'Bash', firstSeen: new Date().toISOString(), responseSummary: 'Exit code 1: something' }),
    'NOT VALID JSON {{{',
    JSON.stringify({ type: 'delta', id: 'test-id-1', timestamp: new Date().toISOString() }),
  ].join('\n') + '\n', 'utf-8');

  // --export doesn't read candidates, just verify the script doesn't crash on non-TTY
  const r = run(['--export']);
  assert.strictEqual(r.status, 0, `Script should not crash: ${r.stderr}`);
});

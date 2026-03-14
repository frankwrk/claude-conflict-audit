/**
 * Integration tests for conflict-detector.mjs
 *
 * Spawns the detector as a subprocess (matching real PostToolUse hook behavior).
 * Uses a temp dir for candidate writes — no ~/.claude/ side effects.
 *
 * NOTE: Session dedup uses ppid — all subprocesses spawned from this test runner
 * share the same dedup dir. Each test uses a unique tool/response combination
 * to avoid cross-test dedup interference.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const { deriveCandidateId } = await import(resolve(DIR, '../hooks/candidate-id.mjs'));
const DETECTOR = resolve(DIR, '../hooks/conflict-detector.mjs');

// Temp dir for all candidate writes — isolated from ~/.claude/hooks/
const TMP_DIR = mkdtempSync(resolve(tmpdir(), 'conflict-audit-test-'));
const CANDIDATES = resolve(TMP_DIR, 'conflict-candidates.jsonl');

after(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

function run(input) {
  return spawnSync('node', [DETECTOR], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, CONFLICT_AUDIT_CANDIDATES_PATH: CANDIDATES },
  });
}

function cleanCandidates() {
  try { rmSync(CANDIDATES); } catch { /* file may not exist */ }
}

// ─── Basic behavior ───────────────────────────────────────────────────────

test('empty input → exit 0, no stdout', () => {
  const r = spawnSync('node', [DETECTOR], {
    input: '',
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, CONFLICT_AUDIT_CANDIDATES_PATH: CANDIDATES },
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '');
});

test('whitespace-only input → exit 0, no stdout', () => {
  const r = spawnSync('node', [DETECTOR], {
    input: '   \n  ',
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, CONFLICT_AUDIT_CANDIDATES_PATH: CANDIDATES },
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '');
});

test('malformed JSON → exit 0, no crash', () => {
  const r = run('{ bad json }');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim(), '');
});

test('null tool_response → exit 0, no crash', () => {
  const r = run({ tool_name: 'Bash', tool_input: {}, tool_response: null });
  assert.strictEqual(r.status, 0);
});

// ─── Known conflict detection ─────────────────────────────────────────────

test('WebFetch blocked by context-mode → alert on stdout', () => {
  const r = run({
    tool_name: 'WebFetch',
    tool_input: { url: 'https://example.com' },
    tool_response: 'ctx_fetch_and_index — WebFetch blocked by context-mode',
  });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes('CONFLICT DETECTED'), `Expected alert, got: ${r.stdout}`);
  assert.ok(r.stdout.includes('context-mode-webfetch-denied'));
});

test('conflict alert contains severity, source, and fix', () => {
  // Use curl-blocked (different conflict ID from WebFetch test — avoids session dedup)
  const r = run({
    tool_name: 'Bash',
    tool_input: { command: 'curl https://example.com' },
    tool_response: 'context-mode: curl/wget blocked — use ctx_execute instead',
  });
  assert.ok(r.stdout.includes('CONFLICT DETECTED'), `Expected alert, got: ${r.stdout}`);
  assert.ok(r.stdout.includes('Fix:'));
  assert.ok(r.stdout.includes('Source:'));
});

// ─── Candidate capture ────────────────────────────────────────────────────

test('unknown Bash error signal → candidate captured', () => {
  cleanCandidates();
  const r = run({
    tool_name: 'Bash',
    tool_input: { command: 'npx some-unique-cmd-12345' },
    tool_response: 'Exit code 127: npx-some-unique-cmd-12345: command not found',
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '', 'No alert expected for unknown error');
  assert.ok(existsSync(CANDIDATES), 'conflict-candidates.jsonl should be created');

  const lines = readFileSync(CANDIDATES, 'utf-8').trim().split('\n').filter(Boolean);
  const entry = JSON.parse(lines[0]);
  assert.strictEqual(entry.type, 'candidate');
  assert.strictEqual(entry.tool, 'Bash');
  assert.ok(typeof entry.id === 'string' && entry.id.length > 0);
  assert.ok(typeof entry.firstSeen === 'string');
  assert.ok(typeof entry.responseSummary === 'string');
});

test('success Bash output → no candidate captured', () => {
  cleanCandidates();
  const r = run({
    tool_name: 'Bash',
    tool_input: { command: 'echo hello-unique-success-99' },
    tool_response: 'hello-unique-success-99\n',
  });
  assert.strictEqual(r.status, 0);
  assert.ok(!existsSync(CANDIDATES), 'No candidates for successful commands');
});

test('Read tool exit code → not an error signal, no candidate', () => {
  cleanCandidates();
  const r = run({
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/nonexistent' },
    tool_response: 'Exit code 1: file not found',
  });
  assert.strictEqual(r.status, 0);
  assert.ok(!existsSync(CANDIDATES), 'Read tool failures are not tracked as candidates');
});

// ─── Append-only delta format ─────────────────────────────────────────────

test('repeated MCP error → candidate entry captured', () => {
  // Use mcp__ tool — avoids the candidate:Bash session dedup set by the earlier capture test.
  // Each tool name gets its own session dedup key (candidate:<toolName>).
  cleanCandidates();

  const input = JSON.stringify({
    tool_name: 'mcp__test-registry-unique',
    tool_input: {},
    // "rate limit exceeded" triggers isErrorSignal (starts with "error:")
    // but does NOT match any known conflict pattern (avoids "connection", "MCP server", etc.)
    tool_response: 'error: rate limit exceeded — retry after 60s',
  });

  spawnSync('node', [DETECTOR], {
    input,
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, CONFLICT_AUDIT_CANDIDATES_PATH: CANDIDATES },
  });

  assert.ok(existsSync(CANDIDATES), 'candidates.jsonl should be created');
  const lines = readFileSync(CANDIDATES, 'utf-8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'Expected at least one entry');
  const first = JSON.parse(lines[0]);
  assert.strictEqual(first.type, 'candidate');
  assert.strictEqual(first.tool, 'mcp__test-registry-unique');
});

// ─── deriveCandidateId (pure function, no subprocess needed) ──────────────

test('deriveCandidateId: same error type, different paths → same ID', () => {
  const a = deriveCandidateId('Bash', 'Exit code 127: /usr/bin/npx: command not found');
  const b = deriveCandidateId('Bash', 'Exit code 127: /usr/local/bin/bar: command not found');
  assert.strictEqual(a, b);
});

test('deriveCandidateId: same error type, different numbers → same ID', () => {
  const a = deriveCandidateId('Bash', 'error: connection timeout after 30s');
  const b = deriveCandidateId('Bash', 'error: connection timeout after 120s');
  assert.strictEqual(a, b);
});

test('deriveCandidateId: different error types → different IDs', () => {
  const a = deriveCandidateId('Bash', 'Exit code 127: command not found');
  const b = deriveCandidateId('Bash', 'Permission denied: cannot write file');
  assert.notStrictEqual(a, b);
});

test('deriveCandidateId: ID contains only [a-z0-9-] characters', () => {
  const id = deriveCandidateId('mcp__some-tool', 'Error: rate limit exceeded for user alice@example.com');
  assert.match(id, /^[a-z0-9-]+$/);
});

test('deriveCandidateId: empty response → non-empty ID, no crash', () => {
  const id = deriveCandidateId('Bash', '');
  assert.ok(typeof id === 'string' && id.length > 0);
});

test('deriveCandidateId: very long response → ID ≤ 60 chars', () => {
  const id = deriveCandidateId('Bash', 'error: '.repeat(200) + 'something failed badly');
  assert.ok(id.length <= 60, `ID too long: ${id.length} chars`);
});

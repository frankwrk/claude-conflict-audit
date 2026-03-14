/**
 * Unit tests for conflict-knowledge.mjs
 * Tests: isErrorSignal(), CONFLICTS array shape
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const { isErrorSignal, CONFLICTS, detectConflicts, detectInConflicts } = await import(resolve(DIR, '../hooks/conflict-knowledge.mjs'));

// ─── isErrorSignal ────────────────────────────────────────────────────────

test('isErrorSignal: Bash exit code [1-9] triggers', () => {
  assert.ok(isErrorSignal('Bash', 'Exit code 127: command not found'));
  assert.ok(isErrorSignal('Bash', 'Exit code 1\nsome output'));
  assert.ok(isErrorSignal('Bash', 'Exit code 2: some error'));
});

test('isErrorSignal: Bash command not found triggers', () => {
  assert.ok(isErrorSignal('Bash', 'command not found: npx'));
  assert.ok(isErrorSignal('Bash', 'bash: npx: command not found'));
});

test('isErrorSignal: Bash permission denied triggers', () => {
  assert.ok(isErrorSignal('Bash', 'permission denied: ./script.sh'));
  assert.ok(isErrorSignal('Bash', '-bash: /usr/local/bin/foo: Permission denied'));
});

test('isErrorSignal: MCP error prefix triggers (single line)', () => {
  assert.ok(isErrorSignal('mcp__nexus', 'error: connection refused'));
  assert.ok(isErrorSignal('mcp__plugin_foo', 'Error: server unavailable'));
});

test('isErrorSignal: MCP error prefix triggers (multiline — m flag)', () => {
  assert.ok(isErrorSignal('mcp__nexus', 'some output\nerror: failed to connect\nmore output'));
});

test('isErrorSignal: MCP connection error triggers', () => {
  assert.ok(isErrorSignal('mcp__nexus', 'error connection lost'));
});

test('isErrorSignal: non-Bash exit code does NOT trigger', () => {
  assert.ok(!isErrorSignal('Read', 'Exit code 1'));
  assert.ok(!isErrorSignal('Grep', 'Exit code 1'));
  assert.ok(!isErrorSignal('Write', 'Exit code 2'));
});

test('isErrorSignal: empty / too-short response does NOT trigger', () => {
  assert.ok(!isErrorSignal('Bash', ''));
  assert.ok(!isErrorSignal('Bash', 'err'));
  assert.ok(!isErrorSignal('Bash', null));
  assert.ok(!isErrorSignal('Bash', undefined));
});

test('isErrorSignal: success output does NOT trigger', () => {
  assert.ok(!isErrorSignal('Bash', 'All tests passed'));
  assert.ok(!isErrorSignal('Bash', '✅ Done'));
  assert.ok(!isErrorSignal('Bash', 'hello world\n'));
});

test('isErrorSignal: ENOENT guard — "command not found" + ENOENT does NOT trigger', () => {
  assert.ok(!isErrorSignal('Bash', 'No such file or directory: /tmp/test'));
  assert.ok(!isErrorSignal('Bash', 'command not found\nNo such file or directory'));
});

test('isErrorSignal: sudo/chmod/chown permission denied does NOT trigger', () => {
  assert.ok(!isErrorSignal('Bash', 'sudo: permission denied'));
  assert.ok(!isErrorSignal('Bash', 'chmod: permission denied'));
  assert.ok(!isErrorSignal('Bash', 'chown: permission denied'));
});

test('isErrorSignal: Exit code 0 does NOT trigger', () => {
  assert.ok(!isErrorSignal('Bash', 'Exit code 0: success'));
});

// ─── CONFLICTS array shape ────────────────────────────────────────────────

test('CONFLICTS is a non-empty array', () => {
  assert.ok(Array.isArray(CONFLICTS));
  assert.ok(CONFLICTS.length > 0, 'Expected at least one conflict pattern');
});

test('each CONFLICT entry has required fields', () => {
  for (const c of CONFLICTS) {
    assert.ok(c.id,                   `Missing id in: ${JSON.stringify(c)}`);
    assert.ok(c.source,               `Missing source in: ${c.id}`);
    assert.ok(c.tool,                 `Missing tool in: ${c.id}`);
    assert.ok(c.severity,             `Missing severity in: ${c.id}`);
    assert.ok(Array.isArray(c.detect),`detect must be array in: ${c.id}`);
    assert.ok(c.description,          `Missing description in: ${c.id}`);
    assert.ok(c.fix?.summary,         `Missing fix.summary in: ${c.id}`);
    assert.ok(c.fix?.example,         `Missing fix.example in: ${c.id}`);
  }
});

test('each CONFLICT severity is valid', () => {
  const valid = new Set(['blocking', 'degraded', 'warning']);
  for (const c of CONFLICTS) {
    assert.ok(valid.has(c.severity), `Invalid severity "${c.severity}" in: ${c.id}`);
  }
});

test('each CONFLICT id is unique', () => {
  const ids = CONFLICTS.map(c => c.id);
  const unique = new Set(ids);
  assert.strictEqual(unique.size, ids.length, 'Duplicate conflict IDs found');
});

// ─── detectConflicts smoke test ───────────────────────────────────────────

test('detectConflicts returns array', () => {
  const result = detectConflicts({ toolName: 'Bash', toolInput: {}, toolResponse: 'hello' });
  assert.ok(Array.isArray(result));
});

test('detectConflicts finds curl-blocked conflict', () => {
  const result = detectConflicts({
    toolName: 'Bash',
    toolInput: { command: 'curl https://example.com' },
    toolResponse: 'context-mode: curl/wget blocked',
  });
  assert.ok(result.length > 0, 'Expected at least one conflict');
  assert.ok(result.some(c => c.id === 'context-mode-curl-blocked'));
});

test('detectConflicts returns empty for clean response', () => {
  const result = detectConflicts({
    toolName: 'Bash',
    toolInput: { command: 'echo hello' },
    toolResponse: 'hello',
  });
  assert.strictEqual(result.length, 0);
});

// ─── detectInConflicts ────────────────────────────────────────────────────

const SYNTHETIC = [{
  id: 'test-conflict',
  tool: 'Bash',
  severity: 'warning',
  source: 'test',
  description: 'test conflict',
  detect: [{ type: 'response-contains', value: 'test-signal' }],
  falsePositiveGuards: [],
  fix: { summary: 'fix it', example: 'example' },
}];

test('detectInConflicts: empty array → no matches', () => {
  const result = detectInConflicts([], { toolName: 'Bash', toolInput: {}, toolResponse: 'test-signal' });
  assert.strictEqual(result.length, 0);
});

test('detectInConflicts: matches entry in synthetic array', () => {
  const result = detectInConflicts(SYNTHETIC, { toolName: 'Bash', toolInput: {}, toolResponse: 'test-signal' });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'test-conflict');
});

test('detectInConflicts: no match when tool differs', () => {
  const result = detectInConflicts(SYNTHETIC, { toolName: 'Read', toolInput: {}, toolResponse: 'test-signal' });
  assert.strictEqual(result.length, 0);
});

test('detectInConflicts(CONFLICTS, data) equals detectConflicts(data)', () => {
  const data = { toolName: 'Bash', toolInput: { command: 'curl x' }, toolResponse: 'context-mode: curl/wget blocked' };
  assert.deepStrictEqual(detectInConflicts(CONFLICTS, data), detectConflicts(data));
});

/**
 * Tests for hook-registry-builder.mjs
 *
 * Unit tests: detectOrderingConflicts(), formatRegistryDiagram() — pure functions, no FS
 * Integration tests: buildHookRegistry() — reads real ~/.claude/settings.json
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const { buildHookRegistry, detectOrderingConflicts, formatRegistryDiagram, inferWritesStdout } =
  await import(resolve(DIR, '../hooks/hook-registry-builder.mjs'));

// ─── inferWritesStdout ────────────────────────────────────────────────────

const TMP = join(tmpdir(), `hook-registry-test-${process.pid}`);
mkdirSync(TMP, { recursive: true });

test('inferWritesStdout: .mjs with console.log → true', () => {
  const f = join(TMP, 'stdout.mjs');
  writeFileSync(f, 'console.log("hello");');
  assert.strictEqual(inferWritesStdout(f), true);
});

test('inferWritesStdout: .mjs with no stdout calls → false', () => {
  const f = join(TMP, 'silent.mjs');
  writeFileSync(f, 'import { appendFileSync } from "node:fs";\nappendFileSync("/tmp/log", "data");');
  assert.strictEqual(inferWritesStdout(f), false);
});

test('inferWritesStdout: .sh with echo → true', () => {
  const f = join(TMP, 'noisy.sh');
  writeFileSync(f, '#!/bin/bash\necho "done"');
  assert.strictEqual(inferWritesStdout(f), true);
});

test('inferWritesStdout: .sh with no echo/printf → false', () => {
  const f = join(TMP, 'silent.sh');
  writeFileSync(f, '#!/bin/bash\ntouch /tmp/marker');
  assert.strictEqual(inferWritesStdout(f), false);
});

test('inferWritesStdout: non-existent file → true (conservative)', () => {
  assert.strictEqual(inferWritesStdout('/nonexistent/path/hook.mjs'), true);
});

// ─── detectOrderingConflicts (pure, no FS) ────────────────────────────────

test('two non-async stdout writers on same event → 1 conflict', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: null, command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PostToolUse', matcher: null, command: 'cmd-b', async: false, writesStdout: true },
  ];
  const conflicts = detectOrderingConflicts(registry);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, 'stdout-ordering');
  assert.strictEqual(conflicts[0].event, 'PostToolUse');
});

test('async hook does not conflict with sync hook', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: null, command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PostToolUse', matcher: null, command: 'cmd-b', async: true,  writesStdout: true },
  ];
  assert.strictEqual(detectOrderingConflicts(registry).length, 0);
});

test('hooks on different events do not conflict', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: null, command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PreToolUse',  matcher: null, command: 'cmd-b', async: false, writesStdout: true },
  ];
  assert.strictEqual(detectOrderingConflicts(registry).length, 0);
});

test('non-overlapping matchers (Write vs Read) do not conflict', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: 'Write', command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PostToolUse', matcher: 'Read',  command: 'cmd-b', async: false, writesStdout: true },
  ];
  assert.strictEqual(detectOrderingConflicts(registry).length, 0);
});

test('null matcher + specific matcher overlap → conflict', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: null,    command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PostToolUse', matcher: 'Write', command: 'cmd-b', async: false, writesStdout: true },
  ];
  assert.strictEqual(detectOrderingConflicts(registry).length, 1);
});

test('same matcher → conflict', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: 'Bash', command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PostToolUse', matcher: 'Bash', command: 'cmd-b', async: false, writesStdout: true },
  ];
  assert.strictEqual(detectOrderingConflicts(registry).length, 1);
});

test('3 conflicting hooks → 3 pairs', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: null, command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PostToolUse', matcher: null, command: 'cmd-b', async: false, writesStdout: true },
    { source: 'c', event: 'PostToolUse', matcher: null, command: 'cmd-c', async: false, writesStdout: true },
  ];
  assert.strictEqual(detectOrderingConflicts(registry).length, 3);
});

test('empty registry → no conflicts', () => {
  assert.strictEqual(detectOrderingConflicts([]).length, 0);
});

// ─── formatRegistryDiagram (pure) ────────────────────────────────────────

test('formatRegistryDiagram returns a string', () => {
  const registry = [
    { source: 'settings.json', event: 'PostToolUse', matcher: null, command: 'node hook.mjs', async: false, writesStdout: true },
  ];
  const diagram = formatRegistryDiagram(registry, []);
  assert.ok(typeof diagram === 'string');
  assert.ok(diagram.includes('HOOK EXECUTION ORDER'));
  assert.ok(diagram.includes('PostToolUse'));
});

test('formatRegistryDiagram with no conflicts shows clean message', () => {
  const registry = [
    { source: 'settings.json', event: 'PostToolUse', matcher: null, command: 'node hook.mjs', async: false, writesStdout: true },
  ];
  const diagram = formatRegistryDiagram(registry, []);
  assert.ok(diagram.includes('✅ No ordering conflicts detected'));
});

test('formatRegistryDiagram with conflicts shows ordering note', () => {
  const registry = [
    { source: 'a', event: 'PostToolUse', matcher: null, command: 'cmd-a', async: false, writesStdout: true },
    { source: 'b', event: 'PostToolUse', matcher: null, command: 'cmd-b', async: false, writesStdout: true },
  ];
  const conflicts = detectOrderingConflicts(registry);
  const diagram = formatRegistryDiagram(registry, conflicts);
  assert.ok(diagram.includes('⚠️'));
  assert.ok(diagram.includes('ORDERING NOTES'));
});

test('formatRegistryDiagram truncates long commands', () => {
  const longCmd = '/a/very/long/path/that/exceeds/the/forty/character/limit/hook.mjs';
  const registry = [
    { source: 'settings.json', event: 'PostToolUse', matcher: null, command: longCmd, async: false, writesStdout: true },
  ];
  const diagram = formatRegistryDiagram(registry, []);
  assert.ok(diagram.includes('...'), 'Long commands should be truncated with ...');
});

test('formatRegistryDiagram marks async hooks', () => {
  const registry = [
    { source: 'settings.json', event: 'SessionStart', matcher: null, command: 'bash startup.sh', async: true, writesStdout: true },
  ];
  const diagram = formatRegistryDiagram(registry, []);
  assert.ok(diagram.includes('[async]'));
});

// ─── buildHookRegistry (integration — reads real ~/.claude/settings.json) ─

test('buildHookRegistry returns an array', async () => {
  const registry = await buildHookRegistry();
  assert.ok(Array.isArray(registry));
});

test('registry entries have required shape', async () => {
  const registry = await buildHookRegistry();
  for (const h of registry) {
    assert.ok(typeof h.source === 'string',  `source must be string, got: ${typeof h.source}`);
    assert.ok(typeof h.event === 'string',   `event must be string, got: ${typeof h.event}`);
    assert.ok(typeof h.command === 'string', `command must be string, got: ${typeof h.command}`);
    assert.ok(typeof h.async === 'boolean',  `async must be boolean, got: ${typeof h.async}`);
    assert.ok(typeof h.writesStdout === 'boolean', `writesStdout must be boolean`);
  }
});

test('registry finds at least 1 PostToolUse hook (conflict-detector is registered)', async () => {
  const registry = await buildHookRegistry();
  const ptu = registry.filter(h => h.event === 'PostToolUse');
  assert.ok(ptu.length >= 1, `Expected ≥1 PostToolUse hook, found ${ptu.length}`);
});

test('all registry event names are valid Claude Code events', async () => {
  const valid = new Set(['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop']);
  const registry = await buildHookRegistry();
  for (const h of registry) {
    assert.ok(valid.has(h.event), `Unexpected event: "${h.event}" from source: ${h.source}`);
  }
});

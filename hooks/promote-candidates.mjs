#!/usr/bin/env node
/**
 * promote-candidates.mjs — Candidate Promotion Tool
 *
 * Reads conflict-candidates.jsonl, groups by pattern, and interactively
 * promotes high-confidence candidates into learned-conflicts.mjs.
 *
 * Usage:
 *   node ~/.claude/hooks/promote-candidates.mjs           # interactive review
 *   node ~/.claude/hooks/promote-candidates.mjs --export  # dump conflicts.json to stdout
 *
 * PROMOTION FLOW
 * ──────────────────────────────────────────────────────────────
 * conflict-candidates.jsonl  →  aggregate by id  →  sort by occurrences
 *   │                                                     │
 *   └─[missing/empty]─────────────────── "No candidates" exit 0
 *                                                         │
 *                              display with [HIGH ≥5] / [LOW <5] labels
 *                                                         │
 *                              interactive [p]romote / [d]ismiss / [s]kip
 *                                                         │
 *                              write learned-conflicts.mjs
 *                                │
 *                                ├─ node --check  →  [fail] rollback
 *                                │
 *                                └─ node generate-conflict-checks.mjs
 *
 * --export mode: skip prompts, output CONFLICTS+LEARNED to stdout (no sensitive fields)
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

const CANDIDATES_PATH = process.env.CONFLICT_AUDIT_CANDIDATES_PATH
  ?? resolve(homedir(), ".claude", "hooks", "conflict-candidates.jsonl");

const LEARNED_PATH = process.env.CONFLICT_AUDIT_LEARNED_PATH
  ?? resolve(HOOK_DIR, "learned-conflicts.mjs");

const GENERATOR = resolve(HOOK_DIR, "generate-conflict-checks.mjs");

const ARGS = process.argv.slice(2);
const EXPORT_MODE = ARGS.includes("--export");

// ─── Export mode ──────────────────────────────────────────────────────────

if (EXPORT_MODE) {
  const { CONFLICTS } = await import(resolve(HOOK_DIR, "conflict-knowledge.mjs"));
  const { LEARNED_CONFLICTS } = await import(LEARNED_PATH);

  // Strip sensitive runtime fields — safe for community sharing
  const sanitize = (c) => ({
    id: c.id,
    source: c.source,
    tool: c.tool,
    severity: c.severity,
    detect: c.detect,
    falsePositiveGuards: c.falsePositiveGuards ?? [],
    description: c.description,
    fix: c.fix,
  });

  const all = [...CONFLICTS, ...LEARNED_CONFLICTS].map(sanitize);
  process.stdout.write(JSON.stringify(all, null, 2) + "\n");
  process.exit(0);
}

// ─── Interactive mode ─────────────────────────────────────────────────────

if (!process.stdin.isTTY) {
  console.error("promote-candidates requires an interactive terminal.");
  console.error("Run directly: node ~/.claude/hooks/promote-candidates.mjs");
  process.exit(1);
}

// ─── Read and aggregate candidates ───────────────────────────────────────

if (!existsSync(CANDIDATES_PATH)) {
  console.log("No candidates yet. Run /conflict-audit to capture unknown failures.");
  process.exit(0);
}

const raw = readFileSync(CANDIDATES_PATH, "utf-8").trim();
if (!raw) {
  console.log("No candidates yet.");
  process.exit(0);
}

const counts = {};   // id → occurrence count
const meta = {};     // id → first candidate entry

for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  let entry;
  try { entry = JSON.parse(line); } catch { continue; /* skip corrupt lines */ }
  counts[entry.id] = (counts[entry.id] ?? 0) + 1;
  if (entry.type === "candidate" && !meta[entry.id]) meta[entry.id] = entry;
}

const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

if (ids.length === 0) {
  console.log("No candidates yet.");
  process.exit(0);
}

// ─── Load already-promoted IDs ────────────────────────────────────────────

const { LEARNED_CONFLICTS: existing } = await import(LEARNED_PATH);
const promotedIds = new Set(existing.map((c) => c.id));

const pending = ids.filter((id) => !promotedIds.has(id));

if (pending.length === 0) {
  console.log(`All ${ids.length} candidate(s) already promoted.`);
  process.exit(0);
}

// ─── Display candidates ───────────────────────────────────────────────────

console.log(`\nConflict Candidates — ${pending.length} to review\n${"─".repeat(52)}`);
for (const id of pending) {
  const n = counts[id];
  const label = n >= 5 ? "[HIGH]" : "[LOW] ";
  const m = meta[id];
  console.log(`\n${label} ${id}  (${n} occurrence${n === 1 ? "" : "s"})`);
  if (m?.tool)             console.log(`  Tool:     ${m.tool}`);
  if (m?.responseSummary)  console.log(`  Response: ${m.responseSummary.slice(0, 120)}`);
}
console.log(`\n${"─".repeat(52)}`);
console.log("Actions: [p]romote  [d]ismiss  [s]kip\n");

// ─── Interactive prompts ──────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const toPromote = [];
let promoted = 0, dismissed = 0, skipped = 0;

for (const id of pending) {
  const n = counts[id];
  const label = n >= 5 ? "[HIGH]" : "[LOW] ";
  const answer = await ask(`${label} ${id} (${n}×) [p/d/s]: `);
  const a = answer.trim().toLowerCase();
  if (a === "p") {
    toPromote.push({ id, occurrences: n, meta: meta[id] });
    promoted++;
  } else if (a === "d") {
    dismissed++;
  } else {
    skipped++;
  }
}

rl.close();

if (toPromote.length === 0) {
  console.log(`\nDone. Promoted: 0. Dismissed: ${dismissed}. Skipped: ${skipped}.`);
  process.exit(0);
}

// ─── Serialize and write learned-conflicts.mjs ────────────────────────────

/**
 * Build new LEARNED_CONFLICTS entries from promoted candidates.
 * Only string-based detect rules are safe to serialize — assert this explicitly.
 * (Auto-captured candidates structurally only use response-contains / tool-is rules.)
 */
const STRING_DETECT_TYPES = new Set([
  "response-contains", "response-contains-any", "input-contains",
  "input-not-contains", "tool-is",
]);

function buildEntry(candidate) {
  const { id, meta: m } = candidate;
  const detectRule = { type: "response-contains", value: (m?.responseSummary ?? "").slice(0, 60) };

  // Assert: only string-based rule types may be serialized (no RegExp)
  if (!STRING_DETECT_TYPES.has(detectRule.type)) {
    throw new Error(`Cannot serialize detect rule type "${detectRule.type}" for id "${id}"`);
  }

  return {
    id,
    source: `learned (promoted from candidates — ${new Date().toISOString().slice(0, 10)})`,
    tool: m?.tool ?? "Bash",
    severity: "degraded",
    detect: [detectRule],
    falsePositiveGuards: [],
    description: `Auto-promoted pattern: ${m?.responseSummary?.slice(0, 120) ?? id}`,
    fix: {
      summary: `Review and edit this entry in ${LEARNED_PATH}`,
      example: `# Edit learned-conflicts.mjs to refine the detect rule and fix guidance`,
    },
  };
}

const newEntries = toPromote.map(buildEntry);
const allEntries = [...existing, ...newEntries];

const newSource =
  `#!/usr/bin/env node\n` +
  `/**\n` +
  ` * Learned Conflict Patterns\n` +
  ` *\n` +
  ` * Auto-promoted patterns from conflict-candidates.jsonl.\n` +
  ` * Same schema as CONFLICTS[] in conflict-knowledge.mjs.\n` +
  ` *\n` +
  ` * DO NOT hand-edit entries below the marker — use /conflict-audit --candidates to promote.\n` +
  ` * Hand-editing the description/fix fields is fine.\n` +
  ` *\n` +
  ` * Generated by: conflict-detector.mjs (promotion flow, Phase 2)\n` +
  ` */\n\n` +
  `// ─── LEARNED PATTERNS (promoted from candidates) ─────────────────────────────\n` +
  `export const LEARNED_CONFLICTS = ${JSON.stringify(allEntries, null, 2)};\n`;

// Backup before write
const backupPath = `${LEARNED_PATH}.bak-${Date.now()}`;
try {
  copyFileSync(LEARNED_PATH, backupPath);
} catch {
  console.error(`❌ Could not back up ${LEARNED_PATH}. Aborting.`);
  process.exit(1);
}

// Write new file
try {
  writeFileSync(LEARNED_PATH, newSource, "utf-8");
} catch (err) {
  // Restore backup on write failure
  try { copyFileSync(backupPath, LEARNED_PATH); } catch {}
  console.error(`❌ Write failed: ${err.message}. Rolled back.`);
  process.exit(1);
}

// Validate syntax
const check = spawnSync("node", ["--check", LEARNED_PATH], { encoding: "utf-8" });
if (check.status !== 0) {
  try { copyFileSync(backupPath, LEARNED_PATH); } catch {}
  console.error(`❌ Syntax check failed — rolled back.\n${check.stderr}`);
  process.exit(1);
}

console.log(`\n✅ Wrote ${newEntries.length} new pattern(s) to ${LEARNED_PATH}`);

// Regenerate docs
const gen = spawnSync("node", [GENERATOR], { encoding: "utf-8" });
if (gen.status !== 0) {
  console.warn(`⚠️  Doc regeneration failed. Run manually:\n  node ${GENERATOR}`);
} else {
  console.log("✅ Regenerated conflict-checks.md");
}

console.log(`\nDone. Promoted: ${promoted}. Dismissed: ${dismissed}. Skipped: ${skipped}.`);

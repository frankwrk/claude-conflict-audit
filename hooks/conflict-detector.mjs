#!/usr/bin/env node
/**
 * Conflict Detector — PostToolUse hook
 *
 * Monitors every tool call for known conflict patterns and emits
 * structured alerts with traces and fix suggestions.
 *
 * Never crashes the session — all errors are swallowed silently.
 * Only fires once per unique conflict ID per session (deduplication).
 */

import { appendFileSync, mkdirSync, openSync, closeSync, constants as fsConstants, readSync, fstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

// ─── Load knowledge base ─────────────────────────────────────────────────
const { detectConflicts, matchDetectRule, isFalsePositive, isErrorSignal } = await import(resolve(HOOK_DIR, "conflict-knowledge.mjs"));
const { LEARNED_CONFLICTS } = await import(resolve(HOOK_DIR, "learned-conflicts.mjs"));

// ─── Session-scoped deduplication (file-based, cross-process) ────────────
// Use ppid as session identifier (constant for process lifetime)
const SESSION_ID = String(process.ppid);
const DEDUP_DIR = resolve(tmpdir(), `conflict-detector-${SESSION_ID}`);
try { mkdirSync(DEDUP_DIR, { recursive: true }); } catch {}

function hasSeenThisSession(conflictId) {
  const marker = resolve(DEDUP_DIR, conflictId.replace(/[^a-z0-9-]/gi, "_"));
  try {
    const fd = openSync(marker, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
    closeSync(fd);
    return false; // first time this session
  } catch {
    return true;  // already fired this session
  }
}

// ─── Log file ────────────────────────────────────────────────────────────
const LOG_PATH = resolve(homedir(), ".claude", "conflict-log.jsonl");

// CANONICAL PATH for conflict candidates — also referenced in conflict-audit/SKILL.md bash snippets.
// If this path changes, update both places.
const CANDIDATES_PATH = resolve(homedir(), ".claude", "hooks", "conflict-candidates.jsonl");

function logConflict(entry) {
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* best effort */ }
}

function captureCandidate({ toolName, toolInput, toolResponse, timestamp }) {
  try {
    // Generate a stable ID from tool + first 60 chars of response
    const raw = `${toolName}:${toolResponse.slice(0, 60)}`;
    const candidateId = raw.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);

    // Append-only design: always append, compute occurrences at read time.
    // O(1) on the hot path — only a tail-read for dedup check.
    //
    // File format (NDJSON):
    //   {type:"candidate", id, tool, firstSeen, inputSummary, responseSummary}  — first occurrence
    //   {type:"delta",     id, timestamp}                                        — subsequent hits
    //
    // Read-time aggregation groups by id, sums lines for occurrences.

    // Tail-read only (last 50KB) — crash-safe, O(1) regardless of file size
    const SCAN_TAIL = 50 * 1024;
    let content = "";
    try {
      const buf = Buffer.alloc(SCAN_TAIL);
      const fd = openSync(CANDIDATES_PATH, fsConstants.O_RDONLY);
      const st = fstatSync(fd);
      const pos = Math.max(0, st.size - SCAN_TAIL);
      const bytesRead = readSync(fd, buf, 0, SCAN_TAIL, pos);
      closeSync(fd);
      content = buf.subarray(0, bytesRead).toString("utf-8");
    } catch { /* file doesn't exist yet */ }

    const isNew = !content.includes(`"id":"${candidateId}"`);

    if (isNew) {
      const entry = {
        type: "candidate",
        id: candidateId,
        firstSeen: timestamp,
        tool: toolName,
        inputSummary: JSON.stringify(toolInput).slice(0, 200),
        responseSummary: toolResponse.slice(0, 500),
      };
      appendFileSync(CANDIDATES_PATH, JSON.stringify(entry) + "\n", "utf-8");
    } else {
      // Lightweight delta — no read-modify-write, no atomicity risk
      const delta = { type: "delta", id: candidateId, timestamp };
      appendFileSync(CANDIDATES_PATH, JSON.stringify(delta) + "\n", "utf-8");
    }
  } catch { /* never crash the hook */ }
}

/**
 * Detect conflicts using a caller-supplied array (for LEARNED_CONFLICTS).
 * Mirrors the logic in detectConflicts() but operates on a given array.
 */
function detectInArray(conflictsArray, { toolName, toolInput, toolResponse }) {
  const data = { toolName, toolInput, toolResponse };
  const matches = [];
  for (const conflict of conflictsArray) {
    const toolMatches =
      conflict.tool === toolName ||
      (conflict.tool === "MCP" && toolName.startsWith("mcp__")) ||
      conflict.tool === "*";
    if (!toolMatches) continue;
    const minMatch = conflict.minMatch ?? conflict.detect.length;
    const matchCount = conflict.detect.filter((rule) => matchDetectRule(rule, data)).length;
    if (matchCount < minMatch) continue;
    if (isFalsePositive(conflict.falsePositiveGuards ?? [], data)) continue;
    matches.push(conflict);
  }
  return matches;
}

// ─── Read stdin ──────────────────────────────────────────────────────────
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
    setTimeout(() => resolve(data), 5000); // safety timeout
  });
}

// ─── Format an alert for Claude ─────────────────────────────────────────
function formatAlert(conflict, { toolName }) {
  const lines = [];
  const SEV_ICON = { blocking: "🚫", degraded: "⚠️", warning: "💡" };
  const icon = SEV_ICON[conflict.severity] ?? "⚠️";

  lines.push(`${icon} CONFLICT DETECTED [${conflict.id}]`);
  lines.push(`  Tool:     ${toolName}`);
  lines.push(`  Source:   ${conflict.source}`);
  if (conflict.sourceFile) {
    lines.push(`  Origin:   ${conflict.sourceFile}`);
  }
  lines.push(`  Severity: ${conflict.severity.toUpperCase()}`);
  lines.push("");
  lines.push(`  What happened:`);
  lines.push(`  ${conflict.description}`);
  lines.push("");
  lines.push(`  Fix: ${conflict.fix.summary}`);
  lines.push(`  → ${conflict.fix.example}`);
  if (conflict.fix.altExample) {
    lines.push(`  → (alt) ${conflict.fix.altExample}`);
  }
  lines.push("");
  lines.push(`  (Logged to ~/.claude/conflict-log.jsonl — run /conflict-audit for full history)`);

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────
try {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  const input = JSON.parse(raw);

  const toolName = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};
  const toolResponse = typeof input.tool_response === "string"
    ? input.tool_response
    : JSON.stringify(input.tool_response ?? "");
  const toolOutput = typeof input.tool_output === "string"
    ? input.tool_output
    : JSON.stringify(input.tool_output ?? "");

  // Combine response + output for pattern matching
  const fullResponse = [toolResponse, toolOutput].filter(Boolean).join("\n");

  // Detect conflicts — check both built-in and learned knowledge bases
  const conflicts = [
    ...detectConflicts({ toolName, toolInput, toolResponse: fullResponse }),
    ...detectInArray(LEARNED_CONFLICTS, { toolName, toolInput, toolResponse: fullResponse }),
  ];

  if (conflicts.length === 0) {
    // Auto-learning: capture unrecognized error signals as candidates
    if (isErrorSignal(toolName, fullResponse) && !hasSeenThisSession(`candidate:${toolName}`)) {
      captureCandidate({ toolName, toolInput, toolResponse: fullResponse, timestamp: new Date().toISOString() });
    }
    process.exit(0);
  }

  const timestamp = new Date().toISOString();
  const alerts = [];

  for (const conflict of conflicts) {
    // Deduplicate per session
    if (hasSeenThisSession(conflict.id)) continue;

    // Log to JSONL
    logConflict({
      timestamp,
      id: conflict.id,
      severity: conflict.severity,
      source: conflict.source,
      tool: toolName,
      inputSummary: typeof toolInput === "object"
        ? JSON.stringify(toolInput).slice(0, 200)
        : String(toolInput).slice(0, 200),
      responseSummary: fullResponse.slice(0, 300),
      fix: conflict.fix.summary,
    });

    alerts.push(formatAlert(conflict, { toolName }));
  }

  if (alerts.length > 0) {
    // Output to stdout — Claude Code shows this as a system-reminder
    process.stdout.write(alerts.join("\n\n---\n\n") + "\n");
  }

} catch {
  // PostToolUse must NEVER crash — silent exit
  process.exit(0);
}

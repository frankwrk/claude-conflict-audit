#!/usr/bin/env node
/**
 * Candidate Promotion UI
 *
 * Reads ~/.claude/hooks/conflict-candidates.jsonl, shows each unrecognized
 * error candidate, and lets you promote → learned-conflicts.mjs or dismiss.
 *
 * Usage: node promote-candidates.mjs
 *        (or via /conflict-audit --candidates)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const CANDIDATES_PATH = resolve(homedir(), ".claude", "hooks", "conflict-candidates.jsonl");
const DISMISSED_PATH = resolve(homedir(), ".claude", "hooks", "conflict-dismissed.json");
const LEARNED_PATH = resolve(HOOK_DIR, "learned-conflicts.mjs");
const GENERATOR_PATH = resolve(HOOK_DIR, "generate-conflict-checks.mjs");

const SEV_ICON = { blocking: "🚫", degraded: "⚠️", warning: "💡" };

// ─── Load candidates ──────────────────────────────────────────────────────────

function loadCandidates() {
  if (!existsSync(CANDIDATES_PATH)) return [];
  const lines = readFileSync(CANDIDATES_PATH, "utf-8").trim().split("\n").filter(Boolean);
  const counts = {};
  const meta = {};
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      counts[entry.id] = (counts[entry.id] ?? 0) + 1;
      if (entry.type === "candidate") meta[entry.id] = entry;
    } catch { /* skip malformed lines */ }
  }
  return Object.keys(counts)
    .filter((id) => meta[id]) // only ids with a full candidate row
    .map((id) => ({ ...meta[id], occurrences: counts[id] }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

// ─── Dismissed list ───────────────────────────────────────────────────────────

function loadDismissed() {
  try { return JSON.parse(readFileSync(DISMISSED_PATH, "utf-8")); } catch { return []; }
}

function saveDismissed(list) {
  writeFileSync(DISMISSED_PATH, JSON.stringify(list, null, 2) + "\n", "utf-8");
}

// ─── Write entry to learned-conflicts.mjs ────────────────────────────────────

function appendLearned(entry) {
  const src = readFileSync(LEARNED_PATH, "utf-8");
  const insertAt = src.lastIndexOf("];");
  if (insertAt === -1) throw new Error("Could not find ]; in learned-conflicts.mjs");

  const snippet = `
  {
    id: ${JSON.stringify(entry.id)},
    source: ${JSON.stringify(entry.source)},
    tool: ${JSON.stringify(entry.tool)},
    severity: ${JSON.stringify(entry.severity)},
    detect: [
      // Auto-generated from candidate — edit to refine
      { type: "tool-is", value: ${JSON.stringify(entry.tool)} },
      { type: "response-contains", value: ${JSON.stringify(entry.responseSnippet)} },
    ],
    description: ${JSON.stringify(entry.description)},
    fix: {
      summary: ${JSON.stringify(entry.fixSummary)},
      example: ${JSON.stringify(entry.fixExample)},
    },
  },
`;

  const updated = src.slice(0, insertAt) + snippet + src.slice(insertAt);
  writeFileSync(LEARNED_PATH, updated, "utf-8");
}

// ─── Interactive prompt helpers ───────────────────────────────────────────────

function ask(rl, question, defaultValue = "") {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function askKey(question) {
  // Single-keypress without Enter — falls back to readline on non-TTY
  process.stdout.write(`${question} `);
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf-8");
      process.stdin.once("data", (ch) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(ch.toLowerCase().trim());
      });
    } else {
      // Non-TTY (pipe) — readline
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", (ans) => { rl.close(); resolve(ans.toLowerCase().trim()); });
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const all = loadCandidates();
  const dismissed = loadDismissed();
  const dismissedSet = new Set(dismissed);
  const candidates = all.filter((c) => !dismissedSet.has(c.id));

  if (candidates.length === 0) {
    if (all.length > 0) {
      console.log(`No candidates to review (${all.length} already dismissed).`);
    } else {
      console.log("No candidates yet. The conflict detector will populate them over time.");
    }
    return;
  }

  console.log(`\n${"─".repeat(56)}`);
  console.log(`  Conflict Candidates — ${candidates.length} to review`);
  console.log(`${"─".repeat(56)}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let promotedCount = 0;
  let dismissedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const inputPreview = (c.inputSummary ?? "").slice(0, 120);
    const responsePreview = (c.responseSummary ?? "").slice(0, 200);

    console.log(`── Candidate ${i + 1}/${candidates.length}: ${c.id} ${"─".repeat(Math.max(0, 40 - c.id.length))}`);
    console.log(`   Tool:        ${c.tool}`);
    console.log(`   Occurrences: ${c.occurrences}`);
    console.log(`   First seen:  ${c.firstSeen ?? "unknown"}`);
    console.log(`   Input:       ${inputPreview || "(empty)"}`);
    console.log(`   Response:    ${responsePreview || "(empty)"}`);
    console.log();

    let key;
    try {
      key = await askKey("[p] promote  [d] dismiss  [s] skip  [q] quit >");
    } catch {
      break;
    }

    if (key === "q") {
      console.log("Quit.");
      break;
    }

    if (key === "d") {
      dismissed.push(c.id);
      dismissedSet.add(c.id);
      saveDismissed(dismissed);
      dismissedCount++;
      console.log(`🗑  Dismissed ${c.id}\n`);
      continue;
    }

    if (key === "p") {
      console.log();
      const severity = await ask(rl, "Severity [blocking/degraded/warning]", "degraded");
      const source = await ask(rl, "Source (e.g. \"my-plugin\")");
      const description = await ask(rl, "Description (what happened)");
      const fixSummary = await ask(rl, "Fix summary");
      const fixExample = await ask(rl, "Fix example (code/command)");

      const responseSnippet = (c.responseSummary ?? "").slice(0, 60);

      try {
        appendLearned({
          id: c.id,
          source: source || c.tool,
          tool: c.tool,
          severity,
          responseSnippet,
          description,
          fixSummary,
          fixExample,
        });
        promotedCount++;
        const icon = SEV_ICON[severity] ?? "⚠️";
        console.log(`\n${icon} Promoted ${c.id}\n`);
      } catch (err) {
        console.error(`Error writing to learned-conflicts.mjs: ${err.message}`);
      }
      continue;
    }

    // 's' or enter — skip
  }

  rl.close();

  if (promotedCount > 0) {
    console.log(`\n🔄 Regenerating conflict-checks.md...`);
    try {
      execSync(`node ${JSON.stringify(GENERATOR_PATH)}`, { stdio: "inherit" });
      console.log(`✅ Done — ${promotedCount} promoted, ${dismissedCount} dismissed.`);
    } catch (err) {
      console.error(`Generator failed: ${err.message}`);
    }
  } else {
    const summary = [
      dismissedCount > 0 ? `${dismissedCount} dismissed` : "",
      "no promotions",
    ].filter(Boolean).join(", ");
    console.log(`\nDone (${summary}).`);
  }
}

main().catch((err) => {
  console.error("promote-candidates:", err.message);
  process.exit(1);
});

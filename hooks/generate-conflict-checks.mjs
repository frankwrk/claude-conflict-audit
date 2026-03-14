#!/usr/bin/env node
/**
 * Auto-generates conflict-checks.md from the conflict knowledge bases.
 * Run: node ~/.claude/hooks/generate-conflict-checks.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const { CONFLICTS } = await import(resolve(HOOK_DIR, "conflict-knowledge.mjs"));
const { LEARNED_CONFLICTS } = await import(resolve(HOOK_DIR, "learned-conflicts.mjs"));

const OUTPUT = resolve(
  homedir(), ".claude", "skills", "conflict-audit", "references", "conflict-checks.md"
);

const SEV_ICON = { blocking: "🚫 BLOCKING", degraded: "⚠️ DEGRADED", warning: "💡 WARNING" };

const allConflicts = [...CONFLICTS, ...LEARNED_CONFLICTS];

let md = `# Conflict Check Reference\n\n`;
md += `<!-- AUTO-GENERATED — do not edit directly -->\n`;
md += `<!-- Regenerate: node ~/.claude/hooks/generate-conflict-checks.mjs -->\n`;
md += `<!-- Source: conflict-knowledge.mjs + learned-conflicts.mjs -->\n\n`;
md += `Full check procedures for each known conflict pattern.\n`;
md += `Referenced by SKILL.md Step 3.\n\n---\n\n`;

allConflicts.forEach((c, i) => {
  md += `## Check ${i + 1}: ${c.id}\n\n`;
  md += `**Severity:** ${SEV_ICON[c.severity] ?? c.severity}\n\n`;
  md += `**Source:** \`${c.source}\`\n\n`;
  if (c.sourceFile) md += `**Origin:** \`${c.sourceFile}\`\n\n`;
  md += `**What happens:** ${c.description}\n\n`;
  md += `**Fix:** ${c.fix.summary}\n\n`;
  md += `\`\`\`\n${c.fix.example}\n\`\`\`\n\n`;
  if (c.fix.altExample) {
    md += `**Alternative:**\n\`\`\`\n${c.fix.altExample}\n\`\`\`\n\n`;
  }
  md += `---\n\n`;
});

writeFileSync(OUTPUT, md, "utf-8");
console.log(`✅ Written ${allConflicts.length} checks to ${OUTPUT}`);

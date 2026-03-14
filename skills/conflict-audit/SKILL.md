---
name: conflict-audit
version: 1.1.0
description: Audits installed Claude Code plugins, skills, hooks, and MCP servers for conflicts, broken symlinks, and tool-blocking rules. Use when the user says "check for conflicts", "why is X failing", "audit my plugins", "something is blocked", "install a new plugin", "tool not working", or after installing any new plugin, skill, or MCP server.
author: frank
tags: [hooks, plugins, debugging, mcp, automation]
tools: [Read, Bash, Glob, Grep]
requires_hook: PostToolUse
install: bash install.sh
allowed-tools: "Read Bash Glob Grep"
metadata:
  category: utilities
---

# Conflict Audit

Scans the full Claude Code plugin/skill/hook/MCP setup for known conflicts and runtime errors, then offers actionable fixes.

## How It Works

1. **Runtime audit** — reads `~/.claude/conflict-log.jsonl` for conflicts the PostToolUse detector caught during agent runs
2. **Static audit** — cross-references installed plugins, skills, hooks, and MCPs against known conflict patterns (see `references/conflict-checks.md`)
3. **Reports** — groups findings by severity: 🚫 blocking → ⚠️ degraded → 💡 informational
4. **Fixes** — offers to apply fixes for every blocking finding

## Steps

### Step 0: Pre-install analysis (when user mentions installing a plugin)

If the user says "install X", "add X", "npx skills add X", "safe to install X",
or "check plugin X before installing" — run pre-install analysis BEFORE install:

```bash
# Fetch plugin file tree from GitHub (replace <owner>/<repo> with the plugin being installed)
gh api repos/<owner>/<repo>/git/trees/HEAD --recursive --jq '.tree[].path' 2>/dev/null || echo "FETCH_ERROR"
```

For each SKILL.md and hooks/*.mjs found in the tree:
```bash
gh api repos/<owner>/<repo>/contents/<path> --jq '.content' | base64 -d 2>/dev/null
```

**Scan each file for conflict signals:**
- Any mention of `WebFetch` → BLOCKING if context-mode is active
- Any mention of `curl` or `wget` in instructions → DEGRADED if context-mode active
- Any `PostToolUse` hook definition → note in hook registry, check for ordering conflicts
- Any `PreToolUse` hook that blocks tools → check against active tool usage

**Output:**
```
PRE-INSTALL ANALYSIS: <owner>/<plugin>
────────────────────────────────────────
🚫 BLOCKING (N found)   [describe each]
⚠️  DEGRADED (N found)  [describe each]
💡 INFORMATIONAL        [hook additions, etc.]
✅ CLEAN                [N checks passed]

Proceed with install? [y/n/y-with-warnings]
```

If FETCH_ERROR: "Could not fetch plugin files. Proceeding without pre-install analysis."

---

### Step 1: Read runtime log

```bash
tail -n 50 ~/.claude/conflict-log.jsonl 2>/dev/null || echo "NO_LOG"
```

Group entries by `id`, count occurrences, note last timestamp. If NO_LOG, note "No runtime conflicts recorded yet."

### Step 2: Read installed configuration

```bash
ls ~/.claude/skills/
ls -la ~/.claude/skills/ | grep "^l"
ls ~/.claude/hooks/
ls ~/.claude/plugins/marketplaces/
```

Also read `~/.claude/settings.json` and `~/.claude/CLAUDE.md`.

### Step 3: Run all static checks

See `references/conflict-checks.md` for the full check list. Run each check in order.

#### 3h. Hook execution order registry

```bash
node -e "
import('/Users/frank/.claude/hooks/hook-registry-builder.mjs').then(async m => {
  const registry = await m.buildHookRegistry();
  const conflicts = m.detectOrderingConflicts(registry);
  console.log(m.formatRegistryDiagram(registry, conflicts));
});
"
```

Include the output in the static analysis section of the report.

### Step 4: Compile and output the report

```
═══════════════════════════════════════════════
  CONFLICT AUDIT REPORT — <timestamp>
═══════════════════════════════════════════════

RUNTIME CONFLICTS (from ~/.claude/conflict-log.jsonl)
  <id>  ×<count>  last seen <timestamp>
  — or — "None recorded"

STATIC ANALYSIS
  🚫 BLOCKING (<N>)
    [id]  Source: ...  Origin: ...  Problem: ...  Fix: ...

  ⚠️  DEGRADED (<N>)
    [same format]

  💡 INFORMATIONAL (<N>)
    [same format]

  ✅ CLEAN (<N> checks passed)

CANDIDATES HEALTH (auto-captured unknown failures)
──────────────────────────────────────────────────
[run inline node script to count and rate candidates — see bash below]

SUMMARY: <N> blocking, <N> degraded, <N> informational
Log:      ~/.claude/conflict-log.jsonl
Detector: ~/.claude/hooks/conflict-detector.mjs
═══════════════════════════════════════════════
```

```bash
# Count entries and compute daily rate
# NOTE: path matches CANDIDATES_PATH in conflict-detector.mjs — canonical definition is there
node -e "
const fs = require('fs');
const path = require('os').homedir() + '/.claude/hooks/conflict-candidates.jsonl';
try {
  // Append-only format: group by id, count all lines (candidate + deltas) for occurrences
  const lines = fs.readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
  const parsed = lines.map(l => JSON.parse(l));
  const counts = {};
  const meta = {};
  for (const e of parsed) {
    counts[e.id] = (counts[e.id] ?? 0) + 1;
    if (e.type === 'candidate') meta[e.id] = e;
    if (e.timestamp) meta[e.id] = { ...meta[e.id], lastSeen: e.timestamp };
  }
  const ids = Object.keys(counts);
  const week = ids.filter(id => meta[id]?.lastSeen && new Date(meta[id].lastSeen) > new Date(Date.now() - 7*86400000));
  const rate = (week.length / 7).toFixed(1);
  console.log('Total candidates:', ids.length);
  console.log('7d avg/day:', rate, parseFloat(rate) > 10 ? '⚠️  HIGH' : '✅');
  const highConf = ids.filter(id => counts[id] >= 5);
  if (highConf.length > 0) {
    console.log('High-confidence candidates (5+ occurrences):');
    highConf.forEach(id => console.log(' ', id, 'x' + counts[id]));
  }
} catch { console.log('No candidates yet.'); }
"
```

Show high-confidence candidates (5+ occurrences) with a note:
"To promote a candidate to a learned pattern: edit `~/.claude/hooks/learned-conflicts.mjs` and add an entry to LEARNED_CONFLICTS. Then run `node ~/.claude/hooks/generate-conflict-checks.mjs` to regenerate docs."

### Step 5: Offer fixes

For each 🚫 BLOCKING finding, ask: `"Fix [id] now? [y/n]"`. If yes, apply the fix immediately (update symlink, edit CLAUDE.md, update settings.json, etc.).

For ⚠️ DEGRADED findings, list recommended actions but don't auto-apply.

## Examples

**Example 1: Checking after installing a new plugin**
User says: "I just installed firecrawl, check for conflicts"
Actions:
1. Read conflict log for recent firecrawl-related entries
2. Check if firecrawl's skills reference WebFetch (blocked by context-mode)
3. Check if firecrawl's hooks conflict with existing PostToolUse hooks
Result: Report with any blocking issues + fixes offered

**Example 2: Diagnosing a failing tool call**
User says: "why is my curl command getting replaced with an echo?"
Actions:
1. Read conflict log — likely finds `context-mode-curl-blocked` entry
2. Confirms context-mode is active in enabledPlugins
Result: Explains the block, offers ctx_fetch_and_index as the fix

**Example 3: Routine health check**
User says: "audit my plugins"
Actions: Full static + runtime scan
Result: Complete report — typically finds informational items, rarely blocking ones if setup is stable

## Troubleshooting

**Error: conflict-log.jsonl missing**
Cause: No tool failures have been detected yet, or conflict-detector.mjs isn't registered.
Solution: Check that `settings.json` has the PostToolUse hook for `node ~/.claude/hooks/conflict-detector.mjs`. Run a test: `echo '{"tool_name":"Bash","tool_input":{},"tool_response":"context-mode: curl/wget blocked"}' | node ~/.claude/hooks/conflict-detector.mjs`

**Error: Broken symlink not repairable**
Cause: The target skill doesn't exist on disk (e.g. was uninstalled).
Solution: Either reinstall the skill via `npx skills add` or `rm ~/.claude/skills/<name>` to remove the dead link.

**Error: WebFetch blocked unexpectedly**
Cause: context-mode plugin's pretooluse.mjs hook hard-denies all WebFetch calls.
Solution: Use `mcp__plugin_context-mode_context-mode__ctx_fetch_and_index(url, source)` instead, or `gh api` for GitHub URLs.

## Adding new conflict patterns

Edit `~/.claude/hooks/conflict-knowledge.mjs` and add an entry to the `CONFLICTS` array. The PostToolUse hook picks up changes immediately — no restart needed. See the existing entries for the schema.

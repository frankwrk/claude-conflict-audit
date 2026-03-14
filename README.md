# claude-conflict-audit

A general-purpose conflict detection and auto-learning system for Claude Code plugins, skills, hooks, and MCP servers.

## What it does

Three subsystems that work together to keep your Claude Code setup healthy:

### 1. Auto-learning from unknown failures
When a tool call fails with no known conflict pattern, `conflict-detector.mjs` captures it to `conflict-candidates.jsonl`. High-frequency candidates (5+ occurrences) surface in `/conflict-audit` reports for manual promotion to `learned-conflicts.mjs`.

### 2. Pre-install plugin analysis
Before installing a new plugin, `/conflict-audit` fetches the plugin's file tree via `gh api` and scans SKILL.md and hooks for conflict signals — WebFetch usage, curl/wget instructions, PostToolUse hook additions — before a single file is installed.

### 3. Hook registry and ordering conflict detection
`hook-registry-builder.mjs` scans `settings.json` and `plugins/cache/` to build a full hook registry. Detects ordering conflicts: multiple non-async hooks writing stdout on the same event.

---

## File structure

```
hooks/
  conflict-detector.mjs        PostToolUse hook — detects conflicts, captures candidates
  conflict-knowledge.mjs        Built-in conflict patterns + isErrorSignal()
  learned-conflicts.mjs         Auto-promoted patterns (starts empty)
  hook-registry-builder.mjs     Audit-only — builds hook registry, detects ordering conflicts
  generate-conflict-checks.mjs  Regenerates skills/conflict-audit/references/conflict-checks.md

skills/
  conflict-audit/
    SKILL.md                    The /conflict-audit skill
    references/
      conflict-checks.md        Auto-generated from conflict-knowledge.mjs (do not edit directly)
```

---

## Installation

1. Copy `hooks/*.mjs` to `~/.claude/hooks/`
2. Copy `skills/conflict-audit/` to `~/.claude/skills/conflict-audit/`
3. Register the PostToolUse hook in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/<you>/.claude/hooks/conflict-detector.mjs"
          }
        ]
      }
    ]
  }
}
```

4. Run the doc generator once:

```bash
node ~/.claude/hooks/generate-conflict-checks.mjs
```

---

## Usage

Run `/conflict-audit` in any Claude Code session to get a full report:
- Runtime conflicts (from `~/.claude/conflict-log.jsonl`)
- Static checks (8 known patterns)
- Hook execution order diagram
- Candidates health (auto-captured unknowns)

---

## Adding new conflict patterns

Edit `~/.claude/hooks/conflict-knowledge.mjs` and add an entry to the `CONFLICTS` array. Then regenerate docs:

```bash
node ~/.claude/hooks/generate-conflict-checks.mjs
```

The PostToolUse hook picks up changes immediately — no restart needed.

---

## Promoting a candidate to a learned pattern

1. Check candidates in the audit report (high-confidence = 5+ occurrences)
2. Add an entry to `~/.claude/hooks/learned-conflicts.mjs` following the schema in `conflict-knowledge.mjs`
3. Regenerate docs: `node ~/.claude/hooks/generate-conflict-checks.mjs`

---

## Implementation plan

See `2026-03-14-conflict-detection-general.md` for the full implementation plan.

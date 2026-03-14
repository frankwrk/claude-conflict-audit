# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-03-14

### Added
- `conflict-detector.mjs` — PostToolUse hook that detects known conflict patterns, emits structured alerts, and captures unknown error signals as candidates for auto-learning
- `conflict-knowledge.mjs` — built-in conflict pattern library with `detectConflicts()`, `isErrorSignal()`, `matchDetectRule()`, and `isFalsePositive()` exports
- `learned-conflicts.mjs` — scaffold for auto-promoted conflict patterns; same schema as built-in patterns, starts empty
- `hook-registry-builder.mjs` — audit-only module that scans `settings.json` and `plugins/cache/` to build a full hook registry, detect ordering conflicts, and format an ASCII diagram
- `generate-conflict-checks.mjs` — CLI script that auto-generates `conflict-checks.md` from the live knowledge base (DRY: docs stay in sync with code)
- `skills/conflict-audit/SKILL.md` — `/conflict-audit` skill with pre-install gate (Step 0), static conflict checks, hook registry display, and candidates health section
- `skills/conflict-audit/references/conflict-checks.md` — auto-generated reference for all 8 known conflict patterns

### Architecture
- Append-only NDJSON design for `conflict-candidates.jsonl` — O(1) hot-path writes, crash-safe, no read-modify-write
- Tail-read dedup (last 50KB) keeps candidate capture fast regardless of file size
- All subsystems are purely additive — removing any file returns exactly to prior behavior

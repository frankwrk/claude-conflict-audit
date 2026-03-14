# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-03-14

### Added
- `install.sh` — one-liner installer: copies hooks + skill, merges PostToolUse hook into `settings.json` via `node -e` (no `jq` dependency), backs up existing files with timestamps, idempotency check prevents duplicate hook registration, verifies hook runs before confirming success
- `uninstall.sh` — clean removal of all hook files, skill directory, and `settings.json` hook entry
- `hooks/promote-candidates.mjs` — interactive candidate promotion tool: reads `conflict-candidates.jsonl`, groups by pattern with `[HIGH ≥5]`/`[LOW <5]` confidence labels, interactive `[p]romote / [d]ismiss / [s]kip` per entry, writes to `learned-conflicts.mjs` with `node --check` syntax validation + rollback on failure; `--export` flag outputs sanitized `conflicts.json` for community sharing (strips `inputSummary`/`responseSummary`)
- `hooks/pre-commit.sh` — auto-regenerates `conflict-checks.md` when knowledge base files change; install via `ln -s ~/.claude/hooks/pre-commit.sh .git/hooks/pre-commit`
- `test/install.test.mjs` — 11 integration tests for `install.sh` using `spawnSync` with isolated `$HOME` (no `~/.claude/` side effects)
- `test/promote-candidates.test.mjs` — 9 tests covering `--export`, non-TTY guard, missing/empty candidates, sensitive field stripping, and corrupt NDJSON resilience

### Changed
- `SKILL.md` frontmatter: added `version`, `tags`, `tools`, `requires_hook`, and `install` fields for skills.sh marketplace compatibility
- `hooks/conflict-detector.mjs`: `CANDIDATES_PATH` now respects `CONFLICT_AUDIT_CANDIDATES_PATH` env var for test isolation
- `hooks/generate-conflict-checks.mjs`: output path now respects `CONFLICT_AUDIT_GENERATE_OUTPUT` env var for test isolation
- `test/conflict-detector.test.mjs`: uses temp dir + env var — no `~/.claude/` side effects
- `test/generate-conflict-checks.test.mjs`: uses temp dir + env var — no `~/.claude/` side effects
- `TODOS.md`: replaced completed P2/P3 items with new deferred work (uninstall restore from backup, pre-commit auto-wiring, community patterns infrastructure)
- Test suite: 55 → 75 tests (0 failures)

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

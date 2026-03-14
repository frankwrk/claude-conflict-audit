# TODOS

---

## TODO: UX overhaul — install, manage, update, view results, uninstall
Priority: P1
Effort: L
Depends on: install.sh + uninstall.sh (complete as of v1.1.0)

The current UX requires too many manual steps and has no single entry point. A user
should be able to install, update, audit, and uninstall with one command each and
never need to know about individual script paths.

### Problem areas

**Install**
- `curl | bash` works but requires trust in a raw URL with no checksum verification
- No version pinning — users always get HEAD, which could break them mid-session
- No post-install confirmation that the hook is actually firing (just a dry-run verify)
- Pre-commit hook wiring is a separate manual step most users skip

**Update**
- No `conflict-audit update` command — users must re-run the full installer
- No version check — no way to know if you're already on the latest
- No diff of what changed between installed version and latest (learned-conflicts.mjs may
  have grown; users don't know what built-in patterns were added)

**View results**
- Runtime alerts appear inline in Claude's context but disappear after the session
- `conflict-log.jsonl` is raw NDJSON — no human-readable summary command
- `/conflict-audit` skill requires Claude to be running; no standalone CLI summary
- No trend view: "am I hitting the same conflicts more or less than last week?"
- Candidates health is buried in the audit report; no quick `conflict-audit status` command

**Uninstall**
- Works, but no restore path for backed-up files (see separate TODO below)
- Leaves `conflict-candidates.jsonl` by default — should confirm before deleting
  (it's the user's captured learning data, not just a config file)
- No dry-run mode: `uninstall.sh --dry-run` to preview what would be removed

### Proposed implementation

#### 1. `conflict-audit` CLI entrypoint (`bin/conflict-audit`)
A single shell script that dispatches subcommands, installable to `~/.local/bin/`:

```
conflict-audit install          # first-time install
conflict-audit update           # pull latest, preserve learned-conflicts.mjs
conflict-audit status           # one-line health: N conflicts today, N candidates
conflict-audit log [--tail N]   # pretty-print conflict-log.jsonl
conflict-audit promote          # alias for promote-candidates.mjs
conflict-audit export           # alias for promote-candidates.mjs --export
conflict-audit uninstall        # clean removal with restore prompt
conflict-audit version          # print installed vs latest version
```

The CLI entrypoint is what gets added to PATH. Everything else stays in `~/.claude/hooks/`.

#### 2. `conflict-audit update`
```bash
# Compares VERSION in installed conflict-knowledge.mjs against GitHub releases API
# If newer: git clone --depth=1, back up, install, report what changed
# If current: "Already up to date (v1.1.0)"
```

#### 3. `conflict-audit log` (pretty printer)
Reads `conflict-log.jsonl`, groups by `id`, shows:
```
CONFLICT LOG (last 7 days)
────────────────────────────────────────────────
context-mode-curl-blocked      ×12  last: today 22:03  🚫 blocking
context-mode-webfetch-denied   ×11  last: today 22:03  🚫 blocking
mcp-server-unavailable          ×3  last: today 19:47  🚫 blocking
────────────────────────────────────────────────
3 conflict types  ·  26 total hits  ·  0 new patterns (0 high-confidence)
```

#### 4. `conflict-audit status` (one-liner health check)
```bash
# Designed to be added to shell prompt or run quickly
# Output: "conflict-audit: 3 types today, 0 high-confidence candidates ✅"
# Or: "conflict-audit: 1 high-confidence candidate ⚠️  — run 'conflict-audit promote'"
```

#### 5. Checksum verification for curl|bash
Publish a `checksums.txt` with each GitHub release. The installer verifies:
```bash
curl -fsSL .../install.sh -o /tmp/install.sh
curl -fsSL .../checksums.txt | grep install.sh | sha256sum --check
bash /tmp/install.sh
```
Document this as the recommended install path instead of bare `curl | bash`.

#### 6. `uninstall.sh` dry-run + data preservation prompt
```
--dry-run        Preview removals without executing
--keep-data      Skip deletion of conflict-candidates.jsonl and learned-conflicts.mjs
--restore        Restore most recent .bak-* files after removing current versions
```

---

## TODO: uninstall.sh restore from backup
Priority: P2
Effort: S
Depends on: install.sh (complete as of v1.1.0)

When `install.sh` backs up existing files to `<file>.bak-<timestamp>`, `uninstall.sh`
should offer to restore from those backups rather than simply deleting the installed files.
This makes uninstall reversible for users who had customized their `learned-conflicts.mjs`
or `conflict-knowledge.mjs` before upgrading.

Implementation: In `uninstall.sh`, after removing each `.mjs` file, check if any `.bak-*`
sibling exists. If so, print a prompt: "Restore backup? [y/n]" and cp the most recent .bak
back to the original path if confirmed.

---

## TODO: Pre-commit hook auto-wiring
Priority: P2
Effort: S
Depends on: install.sh (complete as of v1.1.0)

Currently, the pre-commit hook (`hooks/pre-commit.sh`) requires a manual `ln -s` step.
Most users won't do this, so doc drift (conflict-checks.md diverging from the knowledge
base) will still happen in practice.

Implementation: Add an optional `--repo <path>` flag to `install.sh` that, when provided,
auto-wires the pre-commit hook into the specified repo's `.git/hooks/pre-commit`. The
`curl | bash` install can't know the target repo, but users installing from a clone can use:
  `bash install.sh --repo /path/to/my-dotfiles`

---

## TODO: Community conflict pattern export — infrastructure
Priority: P3
Effort: M
Depends on: learned-conflicts.mjs populated with patterns, promote-candidates.mjs (complete as of v1.1.0)

The `--export` flag on `promote-candidates.mjs` already generates a shareable `conflicts.json`.
The missing piece is the community receiving end: a GitHub repo (or skills.sh namespace) where
users can submit their exported patterns via PR.

Implementation:
1. Create a `community-patterns/` repo (or directory in this repo)
2. Define a submission workflow: `node ~/.claude/hooks/promote-candidates.mjs --export > my-patterns.json`
   then open a PR to the community repo
3. Add a pattern ingestion script that merges community PRs into a canonical `patterns.json`
4. Optionally: add a `--import <url>` flag to `promote-candidates.mjs` that fetches and merges
   community patterns into `learned-conflicts.mjs`

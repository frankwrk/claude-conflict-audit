# TODOS

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

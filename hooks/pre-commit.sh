#!/usr/bin/env bash
# conflict-audit pre-commit hook
#
# Auto-regenerates conflict-checks.md when knowledge base files change.
# Prevents doc drift without manual discipline.
#
# Installation (per repo):
#   ln -s ~/.claude/hooks/pre-commit.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Or copy directly:
#   cp ~/.claude/hooks/pre-commit.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit

set -euo pipefail

# Resolve the real location of this script (handles symlinks from .git/hooks/)
SCRIPT_REAL="$(realpath "$0" 2>/dev/null || readlink -f "$0" 2>/dev/null || echo "$0")"
GEN_SCRIPT="$(dirname "$SCRIPT_REAL")/generate-conflict-checks.mjs"

# Repo root (where conflict-checks.md lives in the working tree)
REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_OUTPUT="$REPO_ROOT/skills/conflict-audit/references/conflict-checks.md"

# Check if any knowledge/conflict files are staged
if git diff --cached --name-only | grep -qE '(conflict-knowledge|learned-conflicts|conflict-checks)\.'; then
  echo "conflict-audit: knowledge base changed, regenerating conflict-checks.md..."
  if CONFLICT_AUDIT_GENERATE_OUTPUT="$REPO_OUTPUT" node "$GEN_SCRIPT"; then
    git add "$REPO_OUTPUT"
    echo "conflict-audit: conflict-checks.md updated ✅"
  else
    echo "conflict-audit: ❌ doc regeneration failed — fix before committing" >&2
    exit 1
  fi
fi

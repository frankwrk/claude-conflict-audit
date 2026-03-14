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

# Check if any knowledge/conflict files are staged
if git diff --cached --name-only | grep -qE '(conflict-knowledge|learned-conflicts|conflict-checks)\.'; then
  echo "conflict-audit: knowledge base changed, regenerating conflict-checks.md..."
  if node ~/.claude/hooks/generate-conflict-checks.mjs; then
    # Stage the regenerated file if it changed
    git add ~/.claude/skills/conflict-audit/references/conflict-checks.md 2>/dev/null || true
    echo "conflict-audit: conflict-checks.md updated ✅"
  else
    echo "conflict-audit: ❌ doc regeneration failed — fix before committing" >&2
    exit 1
  fi
fi

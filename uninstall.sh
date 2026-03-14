#!/usr/bin/env bash
# conflict-audit uninstaller
#
# Usage:
#   bash uninstall.sh

set -euo pipefail

CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SKILLS_DIR="$CLAUDE_DIR/skills/conflict-audit"
SETTINGS="$CLAUDE_DIR/settings.json"
HOOK_CMD="node $HOOKS_DIR/conflict-detector.mjs"

echo "conflict-audit uninstaller"
echo "──────────────────────────"

# ─── Remove hook files ────────────────────────────────────────────────────

echo ""
echo "Removing hook files..."
for f in \
  "$HOOKS_DIR/conflict-detector.mjs" \
  "$HOOKS_DIR/conflict-knowledge.mjs" \
  "$HOOKS_DIR/learned-conflicts.mjs" \
  "$HOOKS_DIR/hook-registry-builder.mjs" \
  "$HOOKS_DIR/generate-conflict-checks.mjs" \
  "$HOOKS_DIR/promote-candidates.mjs" \
  "$HOOKS_DIR/pre-commit.sh"; do
  if [ -f "$f" ]; then
    rm "$f"
    echo "  ✅ Removed $f"
  fi
done

# ─── Remove skill ─────────────────────────────────────────────────────────

echo ""
echo "Removing skill..."
if [ -d "$SKILLS_DIR" ]; then
  rm -rf "$SKILLS_DIR"
  echo "  ✅ Removed $SKILLS_DIR"
fi

# ─── Remove hook from settings.json ──────────────────────────────────────

echo ""
echo "Removing PostToolUse hook from settings.json..."

if [ ! -f "$SETTINGS" ]; then
  echo "  ℹ️  settings.json not found, nothing to remove."
else
  node -e "
const fs = require('fs');
const settingsPath = '${SETTINGS}';
const hookCmd = '${HOOK_CMD}';

let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
} catch (e) {
  console.error('  ⚠️  Could not parse settings.json: ' + e.message);
  process.exit(0);
}

const groups = settings?.hooks?.PostToolUse ?? [];
let removed = 0;
for (const group of groups) {
  const before = (group.hooks ?? []).length;
  group.hooks = (group.hooks ?? []).filter(h => h.command !== hookCmd);
  removed += before - group.hooks.length;
}
// Remove empty groups
settings.hooks.PostToolUse = groups.filter(g => (g.hooks ?? []).length > 0);
if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
if (removed > 0) {
  console.log('  ✅ Hook removed from settings.json');
} else {
  console.log('  ℹ️  Hook was not registered, nothing to remove.');
}
"
fi

# ─── Done ─────────────────────────────────────────────────────────────────

echo ""
echo "✅ conflict-audit uninstalled."
echo "   Restart Claude Code to deactivate the hook."
echo ""
echo "ℹ️  Backup files (.bak-*) were left in place:"
echo "   ls $HOOKS_DIR/*.bak-* 2>/dev/null || echo '  (none)'"

#!/usr/bin/env bash
# conflict-audit installer
#
# Usage:
#   bash install.sh
#   curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
#
# Requires: bash, node 18+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Detect curl|bash: source files won't be present when the script is streamed.
# If absent, download the repo into a temp dir and use that as SCRIPT_DIR.
if [ ! -f "$SCRIPT_DIR/hooks/conflict-detector.mjs" ] || [ ! -f "$SCRIPT_DIR/skills/conflict-audit/SKILL.md" ]; then
  REPO_URL="https://github.com/frankwrk/claude-conflict-audit"
  TMP_REPO="$(mktemp -d)"
  trap 'rm -rf "$TMP_REPO"' EXIT

  echo "Source files not found locally — downloading from $REPO_URL..."

  if command -v git &>/dev/null; then
    if ! git clone --depth=1 "$REPO_URL" "$TMP_REPO/repo" 2>&1; then
      echo "❌ git clone failed. Check your internet connection."
      exit 1
    fi
    SCRIPT_DIR="$TMP_REPO/repo"
  elif command -v curl &>/dev/null; then
    if ! curl -fsSL "$REPO_URL/archive/refs/heads/main.tar.gz" -o "$TMP_REPO/repo.tar.gz"; then
      echo "❌ Download failed. Check your internet connection."
      exit 1
    fi
    tar -xzf "$TMP_REPO/repo.tar.gz" -C "$TMP_REPO"
    SCRIPT_DIR="$(find "$TMP_REPO" -maxdepth 1 -type d -name 'claude-conflict-audit-*' | head -1)"
    if [ -z "$SCRIPT_DIR" ]; then
      echo "❌ Failed to extract downloaded archive."
      exit 1
    fi
  else
    echo "❌ Neither git nor curl found. Install one and retry."
    exit 1
  fi

  echo "  ✅ Downloaded to $SCRIPT_DIR"
fi
CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SKILLS_DIR="$CLAUDE_DIR/skills/conflict-audit"
SETTINGS="$CLAUDE_DIR/settings.json"
VERSION="1.1.0"
HOOK_CMD="node $HOOKS_DIR/conflict-detector.mjs"

# ─── Preflight checks ─────────────────────────────────────────────────────

echo "conflict-audit v$VERSION installer"
echo "──────────────────────────────────"

# Node 18+ required (ESM + node:test)
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is required but not found."
  echo "   Install: https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found v$(node --version))."
  echo "   Upgrade: https://nodejs.org"
  exit 1
fi

echo "✅ Node.js $(node --version) found"

# ─── Create target directories ────────────────────────────────────────────

mkdir -p "$HOOKS_DIR"
mkdir -p "$SKILLS_DIR/references"

# ─── Copy hook files (with backup) ────────────────────────────────────────

TS=$(date +%Y%m%d%H%M%S)
BACKED_UP=()

copy_with_backup() {
  local src="$1"
  local dst="$2"
  if [ -f "$dst" ]; then
    cp "$dst" "${dst}.bak-${TS}"
    BACKED_UP+=("${dst}.bak-${TS}")
  fi
  cp "$src" "$dst"
}

echo ""
echo "Copying hook files..."
for f in "$SCRIPT_DIR/hooks/"*.mjs "$SCRIPT_DIR/hooks/pre-commit.sh"; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  copy_with_backup "$f" "$HOOKS_DIR/$name"
  echo "  ✅ $HOOKS_DIR/$name"
done

echo ""
echo "Copying skill files..."
# Copy skill — don't overwrite SKILL.md if user has customized it
copy_with_backup "$SCRIPT_DIR/skills/conflict-audit/SKILL.md" "$SKILLS_DIR/SKILL.md"
echo "  ✅ $SKILLS_DIR/SKILL.md"

if [ ${#BACKED_UP[@]} -gt 0 ]; then
  echo ""
  echo "⚠️  Backed up existing files:"
  for b in "${BACKED_UP[@]}"; do
    echo "  $b"
  done
fi

# ─── Register PostToolUse hook in settings.json ───────────────────────────

echo ""
echo "Registering PostToolUse hook..."

SETTINGS="$SETTINGS" HOOK_CMD="$HOOK_CMD" node -e "
const fs = require('fs');
const settingsPath = process.env.SETTINGS;
const hookCmd = process.env.HOOK_CMD;

let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf-8').trim();
  if (raw) {
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      console.error('❌ settings.json is not valid JSON: ' + e.message);
      console.error('   Fix it manually: ' + settingsPath);
      process.exit(1);
    }
  }
}

// Idempotency: check if already registered
const existing = (settings?.hooks?.PostToolUse ?? [])
  .flatMap(g => g.hooks ?? [])
  .map(h => h.command ?? '');

if (existing.includes(hookCmd)) {
  console.log('  ℹ️  Hook already registered, skipping.');
  process.exit(0);
}

// Merge hook entry into first PostToolUse group, or create new group
settings.hooks = settings.hooks ?? {};
settings.hooks.PostToolUse = settings.hooks.PostToolUse ?? [];

if (settings.hooks.PostToolUse.length > 0) {
  settings.hooks.PostToolUse[0].hooks = settings.hooks.PostToolUse[0].hooks ?? [];
  settings.hooks.PostToolUse[0].hooks.push({ type: 'command', command: hookCmd });
} else {
  settings.hooks.PostToolUse.push({ hooks: [{ type: 'command', command: hookCmd }] });
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
console.log('  ✅ Hook registered in ' + settingsPath);
"

# ─── Generate initial docs ────────────────────────────────────────────────

echo ""
echo "Generating conflict-checks.md..."
if node "$HOOKS_DIR/generate-conflict-checks.mjs"; then
  echo "  ✅ Done"
else
  echo "  ⚠️  Generation failed. Run manually:"
  echo "     node $HOOKS_DIR/generate-conflict-checks.mjs"
fi

# ─── Verify hook runs ─────────────────────────────────────────────────────

echo ""
echo "Verifying hook..."
if echo '{}' | node "$HOOKS_DIR/conflict-detector.mjs" >/dev/null 2>&1; then
  echo "  ✅ Hook verified"
else
  echo "  ⚠️  Hook verification failed. Check Node.js path and file permissions."
fi

# ─── Pre-commit hook instructions ─────────────────────────────────────────

echo ""
echo "Optional: prevent doc drift in your repo by wiring the pre-commit hook:"
echo "  ln -s $HOOKS_DIR/pre-commit.sh .git/hooks/pre-commit"
echo "  chmod +x .git/hooks/pre-commit"

# ─── Done ─────────────────────────────────────────────────────────────────

echo ""
echo "✅ conflict-audit v$VERSION installed."
echo "   Restart Claude Code to activate the PostToolUse hook."
echo "   Run: /conflict-audit to check your setup."

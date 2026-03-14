/**
 * Hook Registry Builder
 *
 * Scans settings.json and plugins/cache for all registered hooks.
 * Detects ordering conflicts between hooks that fire on the same event/matcher.
 *
 * ⚠️  AUDIT-ONLY MODULE — do NOT import from conflict-detector.mjs or any PostToolUse hook.
 * This module performs synchronous filesystem I/O (~100 stat calls across plugins/cache).
 * It is safe only in user-invoked contexts (/conflict-audit), not on the hot path.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const SETTINGS_PATH = resolve(HOME, ".claude", "settings.json");
const PLUGINS_CACHE = resolve(HOME, ".claude", "plugins", "cache");

/**
 * Build the full hook registry from settings.json and plugin cache.
 * Returns: Array of { source, event, matcher, command, async, writesStdout }
 *
 * ⚠️  Performs synchronous filesystem I/O. Audit-only — never call from a PostToolUse hook.
 */
export async function buildHookRegistry() {
  const registry = [];

  // ── 1. settings.json hooks ──────────────────────────────────────────────
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    const hooks = settings.hooks ?? {};
    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of groups) {
        for (const hook of (group.hooks ?? [])) {
          registry.push({
            source: "settings.json",
            event,
            matcher: group.matcher ?? null,
            command: hook.command,
            async: hook.async ?? false,
            writesStdout: true, // assume all shell hooks can write stdout
          });
        }
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw new Error(`settings.json parse error: ${e.message}`);
    }
  }

  // ── 2. Plugin cache hooks ────────────────────────────────────────────────
  try {
    const owners = readdirSync(PLUGINS_CACHE);
    for (const owner of owners) {
      const ownerPath = resolve(PLUGINS_CACHE, owner);
      if (!statSync(ownerPath).isDirectory()) continue;
      const plugins = readdirSync(ownerPath);
      for (const plugin of plugins) {
        const pluginPath = resolve(ownerPath, plugin);
        if (!statSync(pluginPath).isDirectory()) continue;
        // Find latest version
        const versions = readdirSync(pluginPath).filter(v => /^\d/.test(v));
        const latest = versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
        if (!latest) continue;
        const hooksPath = resolve(pluginPath, latest, "hooks");
        try {
          const hookFiles = readdirSync(hooksPath);
          for (const file of hookFiles) {
            const event = fileToEvent(file);
            if (!event) continue;
            const hookPath = resolve(hooksPath, file);
            registry.push({
              source: `${owner}/${plugin}`,
              event,
              matcher: null,
              command: hookPath,
              async: false,
              writesStdout: inferWritesStdout(hookPath),
            });
          }
        } catch { /* no hooks dir */ }
      }
    }
  } catch { /* no plugins cache */ }

  return registry;
}

/**
 * Infer whether a hook file writes to stdout via static analysis.
 * Conservative: returns true if unknown, unreadable, or unrecognized extension.
 */
export function inferWritesStdout(filePath) {
  try {
    const src = readFileSync(filePath, "utf-8");
    if (/\.(mjs|js)$/i.test(filePath)) {
      return /process\.stdout\.write|console\.(log|info|dir)\b/.test(src);
    }
    if (/\.sh$/i.test(filePath)) {
      return /\becho\b|\bprintf\b/.test(src);
    }
  } catch { /* unreadable */ }
  return true;
}

function fileToEvent(filename) {
  const map = {
    "pretooluse.mjs": "PreToolUse",
    "pretooluse.js": "PreToolUse",
    "posttooluse.mjs": "PostToolUse",
    "posttooluse.js": "PostToolUse",
    "sessionstart.mjs": "SessionStart",
    "sessionstart.sh": "SessionStart",
    "stop.mjs": "Stop",
    "stop.sh": "Stop",
  };
  return map[filename.toLowerCase()] ?? null;
}

/**
 * Detect ordering conflicts:
 * - Multiple non-async hooks on the same event with overlapping matchers both writing stdout
 */
export function detectOrderingConflicts(registry) {
  const conflicts = [];
  const byEvent = {};

  for (const hook of registry) {
    byEvent[hook.event] = byEvent[hook.event] ?? [];
    byEvent[hook.event].push(hook);
  }

  for (const [event, hooks] of Object.entries(byEvent)) {
    if (hooks.length < 2) continue;
    const stdoutWriters = hooks.filter(h => h.writesStdout && !h.async);
    if (stdoutWriters.length > 1) {
      for (let i = 0; i < stdoutWriters.length; i++) {
        for (let j = i + 1; j < stdoutWriters.length; j++) {
          const a = stdoutWriters[i];
          const b = stdoutWriters[j];
          // Overlapping matchers: both null, one null + one specific, or both same
          const overlap = !a.matcher || !b.matcher || a.matcher === b.matcher;
          if (overlap) {
            conflicts.push({
              event,
              hooks: [a, b],
              type: "stdout-ordering",
              description:
                `Both "${a.source}" and "${b.source}" write stdout on ${event}` +
                (a.matcher ? ` (matcher: ${a.matcher})` : "") +
                ". Order: first registered fires first.",
            });
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Format registry as ASCII diagram for /conflict-audit output.
 */
export function formatRegistryDiagram(registry, conflicts) {
  const lines = [];
  const byEvent = {};

  for (const hook of registry) {
    byEvent[hook.event] = byEvent[hook.event] ?? [];
    byEvent[hook.event].push(hook);
  }

  lines.push("HOOK EXECUTION ORDER");
  lines.push("─".repeat(52));

  for (const event of ["PreToolUse", "PostToolUse", "SessionStart", "Stop"]) {
    const hooks = byEvent[event];
    if (!hooks || hooks.length === 0) continue;
    lines.push(`${event}:`);
    hooks.forEach((h, i) => {
      const matcher = h.matcher ? ` [matcher: ${h.matcher}]` : " (all tools)";
      const asyncFlag = h.async ? " [async]" : "";
      const cmd = h.command.length > 40 ? "..." + h.command.slice(-37) : h.command;
      lines.push(`  ${i + 1}. ${cmd}${matcher}${asyncFlag}`);
      lines.push(`     source: ${h.source}`);
    });
    lines.push("");
  }

  if (conflicts.length > 0) {
    lines.push("⚠️  ORDERING NOTES:");
    for (const c of conflicts) {
      lines.push(`  ${c.description}`);
    }
  } else {
    lines.push("✅ No ordering conflicts detected");
  }

  return lines.join("\n");
}

/**
 * Conflict Knowledge Base
 *
 * Each entry describes a known tool conflict or failure pattern.
 *
 * Fields:
 *   id              — unique identifier
 *   source          — plugin/hook/rule that causes this
 *   sourceFile      — path hint for tracing origin
 *   tool            — affected tool name (canonical Claude Code name)
 *   severity        — "blocking" | "degraded" | "warning"
 *   detect          — array of detection strategies (ALL must pass unless minMatch set)
 *   minMatch        — minimum number of detect rules that must pass (default: all)
 *   falsePositiveGuards — array of patterns; if ANY matches, suppress the alert
 *   description     — human-readable explanation
 *   fix             — { summary, example, altExample? }
 */

export const CONFLICTS = [
  // ─── context-mode: curl/wget blocked ───────────────────────────────────
  {
    id: "context-mode-curl-blocked",
    source: "context-mode plugin (hooks/pretooluse.mjs)",
    sourceFile: "~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs",
    tool: "Bash",
    severity: "blocking",
    detect: [
      { type: "response-contains", value: "context-mode: curl/wget blocked" },
    ],
    falsePositiveGuards: [],
    description:
      "context-mode intercepts Bash commands containing curl or wget and replaces " +
      "them with an echo redirect to protect the context window from raw HTTP output.",
    fix: {
      summary: "Use ctx_fetch_and_index or ctx_execute for HTTP calls instead of curl/wget",
      example:
        'mcp__plugin_context-mode_context-mode__ctx_fetch_and_index(url: "<url>", source: "<label>")',
      altExample:
        'mcp__plugin_context-mode_context-mode__ctx_execute(language: "python", code: "import urllib.request; print(urllib.request.urlopen(\'<url>\').read().decode())")',
    },
  },

  // ─── context-mode: inline HTTP (fetch/requests) blocked ────────────────
  {
    id: "context-mode-inline-http-blocked",
    source: "context-mode plugin (hooks/pretooluse.mjs)",
    sourceFile: "~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs",
    tool: "Bash",
    severity: "blocking",
    detect: [
      { type: "response-contains", value: "context-mode: Inline HTTP blocked" },
    ],
    falsePositiveGuards: [],
    description:
      "context-mode blocks inline HTTP calls (fetch(), requests.get(), http.get()) " +
      "inside Bash commands to keep raw responses out of the context window.",
    fix: {
      summary: "Use ctx_execute to run HTTP code in sandbox",
      example:
        'mcp__plugin_context-mode_context-mode__ctx_execute(language: "python", code: "import requests; r = requests.get(\'<url>\'); print(r.text[:2000])")',
    },
  },

  // ─── context-mode: build tool blocked ──────────────────────────────────
  {
    id: "context-mode-build-tool-blocked",
    source: "context-mode plugin (hooks/pretooluse.mjs)",
    sourceFile: "~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs",
    tool: "Bash",
    severity: "degraded",
    detect: [
      { type: "response-contains", value: "context-mode: Build tool redirected to sandbox" },
    ],
    falsePositiveGuards: [],
    description:
      "context-mode redirects gradle/maven build commands to the sandbox because " +
      "build output is extremely verbose and would flood the context window.",
    fix: {
      summary: "Run build commands via ctx_execute",
      example:
        'mcp__plugin_context-mode_context-mode__ctx_execute(language: "shell", code: "./gradlew build")',
    },
  },

  // ─── gstack browse binary: sandbox permission denied ───────────────────
  {
    id: "gstack-browse-sandbox-blocked",
    source: "Claude Code sandbox (restricts compiled binary execution)",
    sourceFile: "~/.claude/skills/gstack/browse/dist/browse",
    tool: "Bash",
    severity: "blocking",
    detect: [
      { type: "response-contains", value: "permission denied" },
      { type: "response-contains", value: "Exit code 126" },
    ],
    minMatch: 2,
    falsePositiveGuards: [
      // Don't fire if it's a plain file permission issue (not binary exec)
      { type: "input-not-contains", value: "browse/dist/browse" },
    ],
    description:
      "Claude Code's sandbox blocks execution of the gstack browse compiled binary " +
      "(~/.claude/skills/gstack/browse/dist/browse). The binary is executable but " +
      "the sandbox prevents running arbitrary compiled binaries from the home directory.",
    fix: {
      summary: "Add dangerouslyDisableSandbox: true to this Bash tool call",
      example:
        'Bash(command: "B=~/.claude/skills/gstack/browse/dist/browse && $B <command>", dangerouslyDisableSandbox: true)',
    },
  },

  // ─── Generic: exit code 126 (permission denied / sandbox) ──────────────
  {
    id: "sandbox-exec-blocked",
    source: "Claude Code sandbox",
    sourceFile: null,
    tool: "Bash",
    severity: "blocking",
    detect: [
      { type: "response-contains", value: "Exit code 126" },
      { type: "response-contains", value: "permission denied" },
    ],
    minMatch: 2,
    falsePositiveGuards: [
      // Skip if this looks like a file permission issue (chmod/chown context)
      { type: "input-contains-pattern", value: /chmod|chown|sudo|Permission denied.*file/i },
      // Skip if already caught by more specific gstack rule
      { type: "response-contains", value: "browse/dist/browse" },
    ],
    description:
      "Exit code 126 typically means the Claude Code sandbox blocked execution " +
      "of a compiled binary or script. The file is executable but the sandbox " +
      "prevents running it.",
    fix: {
      summary:
        "Add dangerouslyDisableSandbox: true to the Bash tool call if the binary is trusted",
      example: 'Bash(command: "<your command>", dangerouslyDisableSandbox: true)',
    },
  },

  // ─── MCP tool: server not found / connection error ─────────────────────
  {
    id: "mcp-server-unavailable",
    source: "MCP server configuration",
    sourceFile: "~/.claude/settings.json (mcpServers)",
    tool: "MCP",
    severity: "blocking",
    detect: [
      { type: "response-contains-any", values: [
        "MCP server",
        "connection refused",
        "ECONNREFUSED",
        "server not found",
        "tool not found",
      ]},
    ],
    falsePositiveGuards: [],
    description:
      "An MCP tool call failed because the MCP server is unavailable, not running, " +
      "or misconfigured in settings.json.",
    fix: {
      summary: "Check the MCP server is running and configured correctly in ~/.claude/settings.json",
      example:
        "Verify the server process is running, check the command/args in mcpServers config, " +
        "restart Claude Code to reconnect.",
    },
  },

  // ─── context-mode: WebFetch denied (appears in response when tool fails) ─
  {
    id: "context-mode-webfetch-denied",
    source: "context-mode plugin (hooks/pretooluse.mjs)",
    sourceFile: "~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs",
    tool: "WebFetch",
    severity: "blocking",
    detect: [
      { type: "response-contains-any", values: [
        "ctx_fetch_and_index",
        "WebFetch blocked",
        "Blocked by hook",
        "context-mode",
      ]},
    ],
    falsePositiveGuards: [],
    description:
      "context-mode hard-blocks all WebFetch calls. The response will contain an " +
      "explanation redirect. WebFetch is never available when context-mode is active.",
    fix: {
      summary: "Use ctx_fetch_and_index for URLs, gh api for GitHub content",
      example:
        'mcp__plugin_context-mode_context-mode__ctx_fetch_and_index(url: "<url>", source: "<label>")',
      altExample:
        'gh api "repos/<owner>/<repo>/contents/<path>" --jq \'.content\' | base64 -d',
    },
  },

  // ─── Skill not found (wrong directory name / symlink broken) ───────────
  {
    id: "skill-not-found",
    source: "Claude Code skill registry (~/.claude/skills/)",
    sourceFile: "~/.claude/skills/",
    tool: "Skill",
    severity: "blocking",
    detect: [
      { type: "response-contains-any", values: [
        "Unknown skill",
        "skill not found",
        "No such skill",
      ]},
    ],
    falsePositiveGuards: [],
    description:
      "The skill directory doesn't exist, the symlink is broken, or the SKILL.md " +
      "file is missing. Skill names must match the directory name exactly.",
    fix: {
      summary: "Check that ~/.claude/skills/<skill-name>/SKILL.md exists and the symlink is valid",
      example:
        "ls -la ~/.claude/skills/<skill-name>/ — verify SKILL.md is present and readable",
    },
  },
];

/**
 * Match a single detection rule against tool data.
 */
export function matchDetectRule(rule, { toolName, toolInput, toolResponse }) {
  const resp = toolResponse ?? "";
  const inputStr = typeof toolInput === "string"
    ? toolInput
    : JSON.stringify(toolInput ?? {});

  switch (rule.type) {
    case "response-contains":
      return resp.includes(rule.value);

    case "response-contains-any":
      return rule.values.some((v) => resp.includes(v));

    case "input-contains":
      return inputStr.includes(rule.value);

    case "input-not-contains":
      return !inputStr.includes(rule.value);

    case "input-contains-pattern":
      return rule.value.test(inputStr);

    case "tool-is":
      return toolName === rule.value;

    default:
      return false;
  }
}

/**
 * Check if a false-positive guard fires (returns true = suppress the alert).
 */
export function isFalsePositive(guards, data) {
  return guards.some((guard) => matchDetectRule(guard, data));
}

/**
 * Find all matching conflicts in a given conflicts array for a tool call.
 * Shared implementation used by detectConflicts() and conflict-detector.mjs
 * (for learned conflicts).
 */
export function detectInConflicts(conflicts, { toolName, toolInput, toolResponse }) {
  const data = { toolName, toolInput, toolResponse };
  const matches = [];

  for (const conflict of conflicts) {
    // Tool must match (or be "MCP" and tool starts with mcp__)
    const toolMatches =
      conflict.tool === toolName ||
      (conflict.tool === "MCP" && toolName.startsWith("mcp__")) ||
      conflict.tool === "*";
    if (!toolMatches) continue;

    // Check detection rules
    const minMatch = conflict.minMatch ?? conflict.detect.length;
    const matchCount = conflict.detect.filter((rule) => matchDetectRule(rule, data)).length;
    if (matchCount < minMatch) continue;

    // Check false positive guards
    if (isFalsePositive(conflict.falsePositiveGuards ?? [], data)) continue;

    matches.push(conflict);
  }

  return matches;
}

/**
 * Find all matching conflicts for a given tool call (searches built-in CONFLICTS).
 */
export function detectConflicts(data) {
  return detectInConflicts(CONFLICTS, data);
}

/**
 * Heuristic: does this tool response look like an unrecognized error?
 * Used by conflict-detector.mjs to decide whether to capture a candidate.
 *
 * Conservative by design — false negatives are better than noise.
 * Only fires for Bash and MCP tools. Read/Write/Grep failures are not conflicts.
 */
export function isErrorSignal(toolName, toolResponse) {
  if (!toolResponse || toolResponse.length < 5) return false;

  // Bash: exit code signals (non-zero exit always means something went wrong)
  if (toolName === 'Bash') {
    // Exit code with a meaningful number (not exit 0)
    if (/Exit code [1-9]\d*/.test(toolResponse)) return true;
    // command not found (exit 127) — but NOT ENOENT file errors
    if (/command not found/.test(toolResponse) && !/No such file or directory/.test(toolResponse)) return true;
    // permission denied on a binary (not a file chmod issue)
    if (/permission denied/i.test(toolResponse) && !/chown|chmod|sudo/.test(toolResponse)) return true;
  }

  // MCP tools: explicit error responses
  if (toolName.startsWith('mcp__')) {
    if (/^error:/im.test(toolResponse) || /\berror\b.*\bconnection\b/i.test(toolResponse)) return true;
  }

  return false;
}

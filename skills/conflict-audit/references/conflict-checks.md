# Conflict Check Reference

<!-- AUTO-GENERATED — do not edit directly -->
<!-- Regenerate: node ~/.claude/hooks/generate-conflict-checks.mjs -->
<!-- Source: conflict-knowledge.mjs + learned-conflicts.mjs -->

Full check procedures for each known conflict pattern.
Referenced by SKILL.md Step 3.

---

## Check 1: context-mode-curl-blocked

**Severity:** 🚫 BLOCKING

**Source:** `context-mode plugin (hooks/pretooluse.mjs)`

**Origin:** `~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs`

**What happens:** context-mode intercepts Bash commands containing curl or wget and replaces them with an echo redirect to protect the context window from raw HTTP output.

**Fix:** Use ctx_fetch_and_index or ctx_execute for HTTP calls instead of curl/wget

```
mcp__plugin_context-mode_context-mode__ctx_fetch_and_index(url: "<url>", source: "<label>")
```

**Alternative:**
```
mcp__plugin_context-mode_context-mode__ctx_execute(language: "python", code: "import urllib.request; print(urllib.request.urlopen('<url>').read().decode())")
```

---

## Check 2: context-mode-inline-http-blocked

**Severity:** 🚫 BLOCKING

**Source:** `context-mode plugin (hooks/pretooluse.mjs)`

**Origin:** `~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs`

**What happens:** context-mode blocks inline HTTP calls (fetch(), requests.get(), http.get()) inside Bash commands to keep raw responses out of the context window.

**Fix:** Use ctx_execute to run HTTP code in sandbox

```
mcp__plugin_context-mode_context-mode__ctx_execute(language: "python", code: "import requests; r = requests.get('<url>'); print(r.text[:2000])")
```

---

## Check 3: context-mode-build-tool-blocked

**Severity:** ⚠️ DEGRADED

**Source:** `context-mode plugin (hooks/pretooluse.mjs)`

**Origin:** `~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs`

**What happens:** context-mode redirects gradle/maven build commands to the sandbox because build output is extremely verbose and would flood the context window.

**Fix:** Run build commands via ctx_execute

```
mcp__plugin_context-mode_context-mode__ctx_execute(language: "shell", code: "./gradlew build")
```

---

## Check 4: gstack-browse-sandbox-blocked

**Severity:** 🚫 BLOCKING

**Source:** `Claude Code sandbox (restricts compiled binary execution)`

**Origin:** `~/.claude/skills/gstack/browse/dist/browse`

**What happens:** Claude Code's sandbox blocks execution of the gstack browse compiled binary (~/.claude/skills/gstack/browse/dist/browse). The binary is executable but the sandbox prevents running arbitrary compiled binaries from the home directory.

**Fix:** Add dangerouslyDisableSandbox: true to this Bash tool call

```
Bash(command: "B=~/.claude/skills/gstack/browse/dist/browse && $B <command>", dangerouslyDisableSandbox: true)
```

---

## Check 5: sandbox-exec-blocked

**Severity:** 🚫 BLOCKING

**Source:** `Claude Code sandbox`

**What happens:** Exit code 126 typically means the Claude Code sandbox blocked execution of a compiled binary or script. The file is executable but the sandbox prevents running it.

**Fix:** Add dangerouslyDisableSandbox: true to the Bash tool call if the binary is trusted

```
Bash(command: "<your command>", dangerouslyDisableSandbox: true)
```

---

## Check 6: mcp-server-unavailable

**Severity:** 🚫 BLOCKING

**Source:** `MCP server configuration`

**Origin:** `~/.claude/settings.json (mcpServers)`

**What happens:** An MCP tool call failed because the MCP server is unavailable, not running, or misconfigured in settings.json.

**Fix:** Check the MCP server is running and configured correctly in ~/.claude/settings.json

```
Verify the server process is running, check the command/args in mcpServers config, restart Claude Code to reconnect.
```

---

## Check 7: context-mode-webfetch-denied

**Severity:** 🚫 BLOCKING

**Source:** `context-mode plugin (hooks/pretooluse.mjs)`

**Origin:** `~/.claude/plugins/cache/context-mode/*/hooks/pretooluse.mjs`

**What happens:** context-mode hard-blocks all WebFetch calls. The response will contain an explanation redirect. WebFetch is never available when context-mode is active.

**Fix:** Use ctx_fetch_and_index for URLs, gh api for GitHub content

```
mcp__plugin_context-mode_context-mode__ctx_fetch_and_index(url: "<url>", source: "<label>")
```

**Alternative:**
```
gh api "repos/<owner>/<repo>/contents/<path>" --jq '.content' | base64 -d
```

---

## Check 8: skill-not-found

**Severity:** 🚫 BLOCKING

**Source:** `Claude Code skill registry (~/.claude/skills/)`

**Origin:** `~/.claude/skills/`

**What happens:** The skill directory doesn't exist, the symlink is broken, or the SKILL.md file is missing. Skill names must match the directory name exactly.

**Fix:** Check that ~/.claude/skills/<skill-name>/SKILL.md exists and the symlink is valid

```
ls -la ~/.claude/skills/<skill-name>/ — verify SKILL.md is present and readable
```

---


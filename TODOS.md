# TODOS

---

## TODO: /conflict-audit --candidates promotion UI
Priority: P2
Effort: M
Depends on: conflict-detector.mjs candidate capture (complete as of 2026-03-14)

Show captured candidates with one-step promotion:
  [p] promote  [d] dismiss  [s] skip
→ appends entry to ~/.claude/hooks/learned-conflicts.mjs

Implementation: parse conflict-candidates.jsonl, interactive prompt,
write new entry to LEARNED_CONFLICTS array. Then run
`node ~/.claude/hooks/generate-conflict-checks.mjs` to regenerate docs.

---

## TODO: Session-end metrics rollup in session-capture.sh
Priority: P2
Effort: S
Depends on: Stop hook (already fires on every session end)

Append a one-liner to `~/.claude/conflict-metrics.jsonl` at session end:

```sh
echo "{\"date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"alerts\":$(grep -c '"id"' ~/.claude/conflict-log.jsonl 2>/dev/null || echo 0)}" >> ~/.claude/conflict-metrics.jsonl
```

Goal: accumulate alerts/day over weeks to detect trend direction —
declining rate = patterns learned and avoided; flat rate = endemic to setup.

---

## TODO: Community conflict pattern export
Priority: P3
Effort: S (export script) + M (community repo)
Depends on: learned-conflicts.mjs populated with patterns

Export: conflict-knowledge.mjs + learned-conflicts.mjs → conflicts.json
Share: PR to community pattern repo (skills.sh ecosystem)

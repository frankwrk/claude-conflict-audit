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

## TODO: Community conflict pattern export
Priority: P3
Effort: S (export script) + M (community repo)
Depends on: learned-conflicts.mjs populated with patterns

Export: conflict-knowledge.mjs + learned-conflicts.mjs → conflicts.json
Share: PR to community pattern repo (skills.sh ecosystem)

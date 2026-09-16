---
"m68k-lint": patch
---

Added a worked before/after example for every optimization rule, in a new
`docs/rule-examples.md` linked from each rule's id in `docs/rules.md`. Each
example shows only the lines a finding actually covers, plus its impact and
notes, and is generated from the rule's own lint/fix pipeline so it stays
accurate as rules change.

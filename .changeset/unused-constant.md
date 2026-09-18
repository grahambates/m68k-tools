---
"m68k-lint": minor
---

Add `suspicious/unused-constant`, flagging an `equ`/`=` constant referenced nowhere in the project. Off by default and only checked when a project-wide reference index is available, for the same reason `unused-global-label` is opt-in: a constant has no scope of its own, and a header full of hardware equates is written expecting most of it to go unused within its own file. Uses the same project reference index as `unused-global-label`, so it adds no further indexing cost when the two are enabled together.

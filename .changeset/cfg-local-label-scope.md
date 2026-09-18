---
"m68k-lint": patch
---

Resolve local labels within their own routine when building the control-flow graph. A branch to `.loop` used to land on the last `.loop` defined anywhere in the file, which gave wrong answers to every rule that follows control flow (dead register writes, stale condition codes, unreachable code) whenever two routines reused a local label name.

---
"m68k-lint": minor
---

Add `suspicious/dbra-word-counter` and `suspicious/infinite-loop`. The first flags a `DBcc` loop whose counter is a known constant with bits above bit 15 set on entry, since `DBcc` only counts the low word (`move.l #100000,d0` runs 34465 times, `moveq #-1,d0` runs 65536); a counter packed with an outer count and reached with `SWAP` is left alone. The second flags a loop whose every exit is a conditional branch on registers the loop never writes, so it exits on the first pass or never. Loops with no exit, tests that read memory, and loops containing calls, traps, macros or `DBcc` are not reported.

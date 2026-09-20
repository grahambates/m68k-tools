---
"m68k-parser": minor
"68kcounter": patch
---

`iif` now keeps the statement it makes conditional. `ParsedLine.inlineStatement` is that statement parsed as a line of its own, with locations in the `iif` line, so `iif DEBUG move.w d0,d1` has its `move`, its `.w` and its operands, where only the operands and the condition were kept before. The condition still ends at the first blank, as in vasm. 68kcounter counts the statement, with its size and timing, as it would on a line of its own.

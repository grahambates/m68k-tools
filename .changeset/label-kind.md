---
"m68k-parser": minor
---

Add `labelKind`, which classifies what a line's label defines: a `position` in the program, an `offset` (`rs`, `so`, `fo`), an `equate` (`equ`, `=`, `set`, `equr`, `reg` and similar) or a `macro` name.

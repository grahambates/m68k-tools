---
"m68k-parser": minor
---

Add `directiveSize`, the number of bytes a `dc`, `dcb` or `ds` directive emits (and `db`, `dw`, `dl` and `blk`), which the counter and the linter each worked out for themselves. It returns undefined rather than a guess when the length is not known: a count that is not a known number, or a string with a backslash, whose length depends on whether the assembler processes escape sequences. Without a size these directives take a word.

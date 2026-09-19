---
"m68k-parser": minor
---

Add `directiveSize`, the number of bytes a `dc`, `dcb` or `ds` directive emits (and `db`, `dw`, `dl` and `blk`), which the counter and the linter each worked out for themselves. It returns undefined rather than a guess when the length is not known, such as a count that is not a known number. Without a size these directives take a word, and every character of a string counts as written, so `"a\n"` is three bytes.

---
"68kcounter": patch
---

Substitute macro parameters with the routine shared with the other tools, so macro calls are counted the way an assembler expands them. `\0` (the size the macro was called with), `NARG`, `\#`, `\?n` and the `\.`, `\+`, `\-` selectors now work; a numbered argument the call did not supply is empty rather than left in the text; and `\10` is `\1` followed by a zero, as in vasm, where arguments beyond nine are `\a` to `\z` and only in Devpac mode. Definitions are still tracked as the file is read, so timings and byte counts for each expanded line are unchanged.

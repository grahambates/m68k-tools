---
"m68k-lint": minor
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

Rules that combine values now keep an expression the author wrote, not just names. `addq.l #2+1,d0` followed by `addq.l #4,d0` becomes `addq.l #2+1+4,d0` rather than `#7`, and the same applies to consecutive shifts, bit operations, the halved form of `move-immediate-double-byte`, and `combine-address-adjustments`, which now also folds adjustments written with names or expressions (`lea 4*2+8(a0),a0`). A value made only of bare numbers still collapses to its total.

---
"m68k-lint": minor
---

Add `suspicious/unbalanced-stack`, flagging an `rts`, `rte` or `rtr` reached with more pushed than popped, and a point reached by paths that disagree about the stack depth. Follows `-(sp)`, `(sp)+`, `MOVEM`, `PEA`, `LINK`/`UNLK` and adjustments of `SP` from each global label, and goes quiet at anything it cannot follow, such as a macro. Popping more than was pushed is not reported, since removing caller-pushed arguments is a valid convention.

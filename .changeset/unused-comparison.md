---
"m68k-lint": minor
---

Add `suspicious/unused-comparison`, flagging a `CMP`, `CMPA`, `CMPI`, `CMPM`, `TST` or `BTST` whose condition codes are overwritten before any branch, `Scc` or `DBcc` could read them, usually a branch that was never written or was deleted in an edit. Flags reaching a call, a macro or a return are left alone (so `tst.l d0` before `rts` is fine), as is `TST` on memory, which is used deliberately to touch hardware.

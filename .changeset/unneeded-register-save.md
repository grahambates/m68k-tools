---
"m68k-lint": minor
---

Add `optimization/unneeded-register-save`, flagging registers that are saved on entry and restored on exit but never changed in between, and suggesting the trimmed list. Reads `PUSHM` and `POPM` as `movem.l` to and from the stack as well as `movem` itself. Only leaf code is examined: a call, trap, macro or unknown jump in between could change the register, and anything addressing the stack by offset is left alone since trimming the list would move the offsets. `suspicious/unbalanced-stack` now understands `PUSHM` and `POPM` too.

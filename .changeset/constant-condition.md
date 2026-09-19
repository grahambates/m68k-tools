---
"m68k-lint": minor
---

Add `suspicious/constant-condition`, flagging a conditional branch or `Scc` whose outcome is known in advance. Works out the condition codes left by `MOVEQ`, `MOVE`, `CLR`, `TST`, `CMP`, `CMPI` and `CMPA` from operands the register analysis knows, honouring the operation size and the signed and unsigned conditions, and reports only when every path to the branch sets them the same way. An always-taken branch is usually a comparison against the wrong register or a stale value, and a never-taken one is dead code.

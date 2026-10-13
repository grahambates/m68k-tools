---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Register availability uses liveness rather than any later access. A register is available when no path from the cursor reads it before overwriting it in full, following macro expansions in order. Byte and word writes to data registers, and conditional writes, do not count as overwrites.

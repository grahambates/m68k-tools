---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Register analysis recognises registers a block saves on the stack and restores with `.l` `movem` or `move`. A subroutine that preserves a register no longer counts as using it, so the register stays available across the call. A preserved register is not marked as an input, and its hover description comes back after the restore.

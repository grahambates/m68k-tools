---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Register liveness follows `bsr`/`jsr` calls through subroutines in the same file, including nested and recursive calls, instead of treating every register a subroutine touches as used. A register the subroutine overwrites before reading is free before the call. Calls to routines in other files use their header comment's `Inputs:`, `Outputs:` and `Trashes:` as a contract.

---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Register availability follows the branch on the cursor line, so registers used in a loop are no longer reported as available when the cursor is on the loop's closing `dbf`, `bne` or `bra`. With the cursor on an early `rts`, registers used only after it are now available.

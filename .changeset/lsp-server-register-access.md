---
"m68k-lsp-server": patch
---

Fix register access for two instructions in register usage. `SHS` and `SLO` (the synonym spellings of `SCC` and `SCS`) were reported as reading and writing their register when they only write it, and the register destination of `MOVEP` was reported as read and written when it is only written.

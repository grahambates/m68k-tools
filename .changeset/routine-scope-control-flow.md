---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

The scope used by register analysis and the remapping panel follows control flow from its non-local label instead of ending at the first `rts`. Code after a conditional early return, and the targets of local jump tables, are now part of the scope. Branches to other non-local labels are treated as tail calls.

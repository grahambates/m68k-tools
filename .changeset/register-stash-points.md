---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Registers stashed on the stack at several points in a routine are recognised: each restore pairs with the nearest earlier save of the register, instead of a register only being treated as preserved when the routine saves it exactly once.

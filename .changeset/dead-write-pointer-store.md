---
"m68k-lint": patch
"m68k-lint-vscode": patch
---

`suspicious/dead-register-write` no longer reports a store through a postincrement or predecrement pointer, such as `clr.l (a2)+`, when the pointer is overwritten afterwards.

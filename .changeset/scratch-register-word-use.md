---
"m68k-lint": patch
"m68k-lint-vscode": patch
---

`move-immediate-via-scratch` can use a data register that is next written with a word or byte operation and only read at that size, rather than requiring the whole register to be dead.

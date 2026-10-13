---
"m68k-lint": patch
"m68k-lint-vscode": patch
---

`correctness/amiga-custom-register-access` now recognises a custom register by its include name in a displacement when the base register's value is not known, including the offset-base form where the base points part way into the block, such as `clr.w bltamod(a6)` or `clr.w bltamod-C(a6)`.

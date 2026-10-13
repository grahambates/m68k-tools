---
"m68k-lint": patch
"m68k-lint-vscode": patch
---

`correctness/amiga-custom-register-access` now recognises a custom register by its include name in a displacement, such as `clr.w bltamod(a6)`, when the base register's value is not known.

---
"m68k-parser": minor
"m68k-lsp-server": patch
"m68k-lsp": patch
"m68k-lint-vscode": patch
---

Register lists with ranges that span data and address registers, such as `d0-a6` in `movem.l d0-a6,-(sp)`, expand as vasm assembles them: through D0-D7 then A0-A7, with the ends in either order. They previously expanded to no registers. Lists may also name `sp`, and each register is listed once, in MOVEM mask order. The new `parseRegisterList` export expands such a list from text.

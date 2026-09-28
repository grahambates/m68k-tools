---
"m68k-lint": patch
"m68k-lint-vscode": patch
---

Explain unused CMP/TST flags by identifying nearby conditional instructions and the instructions that overwrite the flags they read. Include memory TST when such a conditional use is unambiguous, while preserving manual-only suggestions and conservative handling of calls, macros and control-flow joins.

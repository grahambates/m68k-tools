---
"m68k-lint": patch
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

DIVU, DIVS, DIVUL and DIVSL are now known to set N, Z, V and C, so a condition such as BVS after a divide is read from the divide rather than an earlier instruction. `suspicious/condition-after-preserved-ccr` now only reports a condition carried across an instruction known to leave CCR alone, such as LEA, MOVEA or MOVEM, rather than any instruction the flag semantics do not yet describe.

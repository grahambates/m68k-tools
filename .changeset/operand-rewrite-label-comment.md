---
"m68k-lint": patch
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

Fixed suggestions that rewrite a single operand (`optimization/redundant-zero-displacement`, `portability/include-case` and `correctness/amiga-bit-mask-constant`) writing the line's label and trailing comment twice, so `lbl: move.l 0(a0),d0 ; c` was replaced with `lbl: lbl: move.l (a0),d0 ; c ; c`.

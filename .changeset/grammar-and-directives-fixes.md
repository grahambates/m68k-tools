---
"m68k-parser": patch
"m68k-lsp": patch
---

- `m68k-parser` now recognises the `db`, `dl`, `fopt` and `radix` directives, which were documented but missing from the directive list.
- The assembly syntax grammar (`m68k-lsp`) now highlights floating-point literals, the full set of special/control and FPU registers, all built-in symbols (`__CPU`, `__VASM`, etc.), and no-operand directives used for trailing-comment detection (`endm`, `endif`, `else`, etc.). It also fixes the line-comment `*` rule to no longer swallow parenthesised, bracketed or braced expressions containing multiplication, and corrects macro-parameter escape highlighting to recognise single-letter parameters (`\a`).

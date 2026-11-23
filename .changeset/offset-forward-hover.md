---
"m68k-parser": minor
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Evaluate `rs`, `so` and `fo` offsets on hover and in conditional assembly, following `rsreset`, `rsset`, `clrso`, `setso`, `clrfo`, `setfo` and the `__RS`, `__SO` and `__FO` counters, with the even alignment vasm applies under `-devpac` or `-align`. A constant defined in terms of one that comes later, such as `A equ B*2` above `B equ 3`, is resolved as vasm resolves it: on hover, and in conditions once the later constant is defined. `evaluateConstant` in `m68k-parser` now asks its resolver for built-in symbols such as `__RS`, which stay unknown when the resolver has no value for them.

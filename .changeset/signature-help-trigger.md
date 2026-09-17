---
"m68k-lsp-server": patch
---

Only trigger signature help on `,` rather than on every space, tab or period. Auto-popping up after each keystroke while typing an instruction's first operand obscured the surrounding code; it still triggers when moving to a later operand, and remains available on demand.

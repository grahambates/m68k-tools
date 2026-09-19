---
"m68k-lint": patch
"m68k-lsp-server": patch
---

Resolve local labels the same way everywhere. The linter, the register analysis in the language server and its symbol lookups each decided for themselves which label a local one belongs to, and they disagreed: one let a label defined with `equ` start a new routine, one counted only labels on code, one counted any label. All now use the parser's rule, under which a label that defines a symbol does not start a routine while a label on data does.

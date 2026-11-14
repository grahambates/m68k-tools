---
"m68k-formatter": patch
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Formatting an `iif` line no longer deletes its condition and statement: `foo iif bar equ 42` was being rewritten as `foo iif 42`. The whole `<condition> <statement>` now sits in the operand column, and the statement's mnemonic and size are cased like any other line's.

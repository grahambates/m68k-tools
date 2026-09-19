---
"m68k-lsp-server": patch
---

Use the shared macro expansion from m68k-parser for register usage. Macros defined as `macro Name` (name as an operand) are now expanded as well as `Name: macro`.

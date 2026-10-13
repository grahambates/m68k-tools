---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Limit the default register analysis scope to the macro body when the cursor is inside a macro definition, from `macro` to `endm`, as a routine runs from its label to its return. Labels and returns inside a macro body no longer start or end the routine scope around the definition.

---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Go to definition, find references, document highlights and rename work on macro calls again, including a call made by an `iif` statement. A call's mnemonic was not recorded as a reference to the macro after the symbol table moved to the m68k-parser AST, so the cursor on a call found nothing.

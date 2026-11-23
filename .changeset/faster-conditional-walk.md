---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Evaluate constants and conditional assembly in time proportional to the file's length. Files with many conditionals and many symbols were slow to analyse after each edit, on hover and for inlay hints: about four seconds for 20,000 lines, now a few milliseconds.

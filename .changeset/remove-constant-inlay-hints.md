---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Remove the inlay hints showing the values of constant assignments. Hover shows the values of constants, and of expressions that use them, in decimal and hexadecimal, and the hints pushed end-of-line comments out of their column. The `inlayHints` option in `.m68krc.json` and the `m68k.inlayHints.enabled` setting are deprecated and ignored.

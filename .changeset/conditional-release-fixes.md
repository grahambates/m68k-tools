---
"m68k-parser": patch
"m68k-lsp-server": patch
"m68k-lsp": patch
"m68k-lint": patch
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

Refresh conditional diagnostics when an include changes. Use vasm's ELIF and ELSEIF semantics in the linter and keep conditions undecided when a definition only appears in an inactive or unconfirmed branch.

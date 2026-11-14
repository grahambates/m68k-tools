---
"m68k-parser": patch
"m68k-lsp-server": patch
"m68k-lsp": patch
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

Labels defined with `so` or `fo` no longer start a new local-label scope, matching `rs` and vasm. Previously a `.local` label after `FIELD so.w 1` was tied to `FIELD` rather than the routine containing it, which could misreport unused or unresolved local labels in the linter and break go-to-definition in the language server. The outline now also lists `so` and `fo` labels as offsets.

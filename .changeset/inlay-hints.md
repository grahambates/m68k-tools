---
"m68k-lsp-server": minor
---

Add inlay hints showing the evaluated value of constant assignments (`equ`, `fequ`, `=`, `set`) inline, for expressions beyond a bare decimal literal — a hex/binary/octal literal still gets a decimal hint. Enabled by default via the new `inlayHints.enabled` setting.

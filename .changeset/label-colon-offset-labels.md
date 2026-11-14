---
"m68k-formatter": minor
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Add `equateColon` and `macroColon` formatter options (`"on"`, `"off"` or `"any"`) for colons after names defined with `equ`, `=`, `set`, `equr`, `reg` and similar, and after macro names. `labelColon` no longer applies to these, which restores its behaviour from before the formatter moved onto the m68k-parser AST, when it had started adding colons to every symbol definition. It still applies to `rs`, `so` and `fo` offsets, which are written like `ds`.

Both new options default to `"off"`, including the VS Code extension's `m68k.format.equateColon` and `m68k.format.macroColon` settings, so colons on equates and macro names are removed unless configured otherwise. This also cleans up colons the previous version added in error.

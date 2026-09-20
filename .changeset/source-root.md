---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lsp-server": minor
---

Add `sourceRoot`, the directory relative paths in the source resolve from, to `.m68krc.json`, `m68k-lint.json` (where it overrides the shared file's) and `m68k.sourceRoot` in editor settings. vasm is run there instead of in each file's own directory, so a project whose includes are named from where its build runs (`include "lib/defs.i"`) no longer gets false include errors, and the linter and both language servers look there for includes. Unset keeps the previous behaviour.

A relative `-I` in `vasm.args` is tried from the source root, where vasm is run, and then from the main source's directory, as vasm does, and the linter reads it the same way.

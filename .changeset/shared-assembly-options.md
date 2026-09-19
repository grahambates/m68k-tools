---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lsp-server": minor
---

Share the options that describe how the source is assembled. `processors`, `includePaths` and `caseSensitive` are read from `.m68krc.json` by the linter, its language server and the assembly server, layered under the tool's own config, and `-nocase`, `-I` and `-m` in the vasm arguments are read back as those options. The assembly server now passes `-nocase` to vasm when case is folded by setting, without repeating arguments already given, and warns when `caseSensitive: true` contradicts a `-nocase` argument. The linter CLI now honours `caseSensitive` in its config, which it previously ignored.

The assembly server now finds `.m68krc.json` by walking up from the workspace folder, as the linter does, rather than only in the folder itself.

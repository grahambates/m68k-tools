---
"m68k-lsp-server": minor
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lsp": minor
"m68k-lint-vscode": minor
"68kcounter": minor
"68kcounter-vscode": minor
---

Processor names are read the same way everywhere: Motorola's part names, `mc68000`, `mc68020`, `mc68881` and so on (and `cpu32`), are the ones the settings, schemas and documentation use, and the number alone, `68020`, is accepted too, in any case. This covers `processors` in `.m68krc.json` and the lint config, the `m68k.processors` and `m68kLint.defaults.processors` editor settings, and `--cpu` in the linter and the counter. The counter's `68kcounter.defaultCpu` setting and `--cpu` now list `mc68000` and so on, as the other tools do; `68000` still works.

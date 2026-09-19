---
"m68k-parser": minor
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lsp-server": minor
"68kcounter": minor
---

Keep symbol case by default, as vasm does. `Foo` and `foo` are different symbols unless the assembler was given `-nocase`; the linter used to treat every name as case-insensitive, so two symbols differing only in case merged into one, giving a false conflict for constants, hiding unused labels, and letting a branch to `.Loop` land on `.loop`. Constants, labels, local labels and macros now keep their case throughout, and instruction, directive and register names are still matched without regard to case.

A project assembled with `-nocase` says so: `caseSensitive: false` in `m68k-lint.json`, or in the assembly server's config, which also follows a `-nocase` among the vasm arguments when the setting is unset. 68kcounter's `parse` takes `{ caseSensitive: false }`. The assembly server re-reads every document when the setting changes. `m68k-parser` gains `symbolKey`, and `analyzeLocalLabelScopes` takes the option. Macro names in 68kcounter and the assembly server, which used to ignore case, now keep it like other symbols. `opt c-` in the source is not read yet.

---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

`optimization/unneeded-register-save` offers a safe fix: it trims the register list on the save and every matching restore together, or removes them all when nothing needs saving, keeping labels and comments. With one register left it uses MOVE, as a conditional fix where the flags MOVE sets may still be read, such as by a caller after the return. Word saves are still left to be fixed by hand, because their restore sign-extends.

Suggestions can now rewrite several runs of lines at once through `Suggestion.edits`, applied together with the suggestion's own span or not at all, by `--fix`, interactive review and the language server's quick fixes, which carry one text edit per run.

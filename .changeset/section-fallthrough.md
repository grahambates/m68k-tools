---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Added `suspicious/section-fallthrough`, a warning for code that can run off the end of a section: the last instruction before a switch to another section is not a return, an unconditional branch or jump, or ILLEGAL. Where sections are placed is decided by the output format or linker, not the source order: in an Amiga executable each section is a separate hunk, so execution continues into whatever memory follows it, and a TOS program gathers all code sections ahead of the data, so it runs into the next code section instead of what the source shows next. Reopening the same section continues it and is not reported. The rule is silent where the section cannot be worked out, where the last line is a macro it cannot see into or is made conditional by IIF, and for unreachable code. A call that never returns, such as one to exit the program, cannot be told from one that does and is reported. The end of the file counts as the end of the program when the project index shows that no other file includes it, so a program with only one section is checked too; an included file, or one linted without a project, is not. After a TRAP the rule is silent, since that may be how the program exits (GEMDOS `Pterm0` is `trap #1`).

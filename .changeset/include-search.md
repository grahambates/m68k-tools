---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lsp-server": minor
---

Search for includes as vasm does. vasm looks in the directory it is run in, then in the directory of the main source, then the `-I` paths and `incdir`s, and never beside the file that names the include; the linter and the assembly server looked beside the including file and in the include paths only. They now also look in the directory of the main source (the file nothing else includes) and follow `incdir` directives, so an include named from the main source's directory by a file in another directory, or one reached through `incdir`, is found and its constants and macros are read. Looking beside the including file is kept, so nothing that was found before is lost. Checked against vasm 1.9.

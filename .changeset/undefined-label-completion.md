---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Suggest labels that the code uses but does not define yet while a label is being typed, or at the start of an empty line: local labels referenced in the current routine, such as `.loop` after `bne .loop`, and global labels referenced in the file or its assembly unit. In VS Code, Enter still starts a new line in a label; Tab accepts the suggestion.

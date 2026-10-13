---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

A call to a macro with no definition the workspace can find, directly or from inside another macro, makes register availability unknown from that point instead of counting only the registers passed to it. Register remapping warns about such calls in the scope, since the registers they use cannot be checked.

---
"m68k-lint-langserver": minor
---

Read includes through the config's `includePaths`. A constant or macro defined in an include outside the workspace, such as a shared NDK file the assembler finds through `-I`, now resolves in the editor as it does on the command line. Open editors' unsaved text is used for those files too.

---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Each source file now goes by the nearest `.m68krc.json` (or `.m68krc`) found from its own directory, as the linter does, so a project's config is read when it sits below the workspace folder the editor opened, and a workspace can hold several projects with their own config. Previously only a config at or above the workspace folder was read, and vasm fell back to its default binary and options for everything else. `caseSensitive` and `exclude` still come from the workspace folder's config, since symbols are shared between files.

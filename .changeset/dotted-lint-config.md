---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Name the lint config `.m68klintrc.json`, like the shared `.m68krc.json`. `m68k-lint --init`, the interactive review and the language server's **Ignore this file** quick fix now create `.m68klintrc.json` when a project has no config, and update an existing one under either name. `m68k-lint.json` is still read; where a directory has both, `.m68klintrc.json` is used, and the CLI and language server warn that the other is ignored. `configFileNames` in `m68k-lint/project-config` lists `.m68klintrc.json` first, and `shadowedConfigFiles` names the files a config hides.

---
"m68k-formatter": minor
---

Read formatter options from the `format` section of a shared `.m68krc.json` as well as `.m68k-format.json`, so the CLI agrees with the language server. The nearest of each is loaded and merged, the nearer on top (`.m68k-format.json` where both share a directory), as the language server already did; a `.m68krc.json` with no `format` section is passed over. `--config` accepts either. `findConfigs` and `loadConfigs` are added.

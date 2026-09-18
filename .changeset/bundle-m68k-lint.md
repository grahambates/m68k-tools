---
"m68k-lint": patch
---

Publish a bundled build instead of one output file per source module, and share the CLI's file walking and glob matching with the language servers. The package entry points, the `m68k-lint` binary and the `m68k-lint/project-config` subpath are unchanged; internal module paths under `dist/` were never part of the public exports map. Glob patterns for inputs and `ignorePatterns` are now matched with minimatch, so brace expansion and other standard glob syntax work where the previous small glob subset did not.

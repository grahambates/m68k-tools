---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Add `suspicious/unused-global-label`, flagging a global label referenced nowhere in the project. Off by default and only checked when a project-wide reference index is available: a label with no reference the index can see may still be a linker-specified entry point or a hardware vector table entry placed by address rather than by name, neither of which is visible to source analysis. XDEF and XREF need no special handling -- their operands are ordinary symbol references, so an exported or imported name already counts as used. `_start` is exempt outright as the conventional linker entry point name.

Add `buildProjectReferences` and thread an optional `ProjectReferences` index through `lintParsedFile`/`lintSource` and `RuleContext.projectReferences`, built from the same project scan `buildProjectSymbols` already does. Building it re-parses every project file on top of the constant index's own pass, so both the CLI and the language server now build it only when `needsProjectReferences(config)` says a live rule actually reads it -- in practice, only when `unused-global-label` itself is enabled. Project indexing overall can still be turned off with `projectSymbols: false`.

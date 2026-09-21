# m68k-lint-vscode

## 0.4.0

### Minor Changes

- Release with linter language server 0.4: case-sensitive symbols by default, a shared `.m68krc.json` for processors, include paths, case, escape sequences and source root, vasm-style include search, the statement in an `iif` analysed, and a new rule for backslash escapes in strings. Configuration changes to `.m68krc.json` are picked up.

## 0.3.0

### Minor Changes

- d29fda4: Add `suspicious/unused-global-label`, flagging a global label referenced nowhere in the project. Off by default and only checked when a project-wide reference index is available: a label with no reference the index can see may still be a linker-specified entry point or a hardware vector table entry placed by address rather than by name, neither of which is visible to source analysis. XDEF and XREF need no special handling -- their operands are ordinary symbol references, so an exported or imported name already counts as used. `_start` is exempt outright as the conventional linker entry point name.

  Add `buildProjectReferences` and thread an optional `ProjectReferences` index through `lintParsedFile`/`lintSource` and `RuleContext.projectReferences`, built from the same project scan `buildProjectSymbols` already does. Building it re-parses every project file on top of the constant index's own pass, so both the CLI and the language server now build it only when `needsProjectReferences(config)` says a live rule actually reads it -- in practice, only when `unused-global-label` itself is enabled. Project indexing overall can still be turned off with `projectSymbols: false`.

### Patch Changes

- a76bfa3: `m68k-lint --init` now writes a `$schema` URL pinned to the CLI's version instead of a path into `node_modules`, which rarely exists in an assembly project. The schema `$id` no longer points at the archived standalone repository. The VS Code extension now bundles the schema and validates `m68k-lint.json` and `.m68klintrc.json` against it offline, rather than fetching it from that repository.

## 0.2.0

### Minor Changes

- 953e621: Offer conditional and manual-review replacements as explicitly labelled editor actions while keeping Fix All conservative by default. Make actions accessible throughout a multiline finding. Highlight the affected instruction and operands or instruction sequence when an optimization previously pointed only at its mnemonic.
- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.
- 87d5a19: Collapse duplicate safe optimization replacements and omit provably inferior alternatives on 68000. Group remaining safe alternatives for the same instruction sequence, preserving individual rule details and tradeoffs. CLI review supports numbered choices and VS Code offers separate code actions; automatic fixes leave grouped alternatives for the user to choose.
- 02a4260: Annotate intent-obscuring rule fixes by default using explicit rule metadata. Replace boolean fix annotation options with obfuscated, all, and none modes across the library, CLI, interactive review, and editor. Add project fixAnnotate configuration.

  Migration: replace bare `--fix-annotate` with `--fix-annotate obfuscated`. Replace boolean library and editor annotation settings with `obfuscated` (previous `true`) or `none` (previous `false`); use `all` to annotate every applied fix. Omitting the setting now defaults to rule-specific annotation.

  Classify existing rules for lost constants/expressions and opaque tricks, and expose the classification in the rule documentation. Routine idioms and multiple lines alone do not qualify.

### Patch Changes

- 1a806c9: Show CPU(read,write) cycle savings in editor diagnostics, alternative summaries and fix titles, matching the CLI. Preserve zero values and show unknown measurements as question marks; negative savings indicate increased cost.

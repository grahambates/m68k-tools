# m68k-lint-langserver

## 0.4.0

### Minor Changes

- a8034b3: Know about vasm's `-esc`. `escapeSequences` joins `.m68krc.json` (and `m68k-lint.json`, and `m68k.escapeSequences` in editor settings); an `-esc` among the vasm arguments is read as the option, and the assembly server passes `-esc` to vasm when it is set. With it, a backslash in a string is read as vasm does: `\n \r \t \b \e \f`, `\\ \" \'`, up to three octal digits (`\101`) and `\x` with up to two hex digits are one element each, so string data is shorter than it is written. `m68k-parser` gains `decodeStringEscapes`, and `directiveSize` takes `escapeSequences`; the linter's alignment analysis and 68kcounter's `parse` use it. Sequences checked against vasm's own output; `\a` and `\v` are not supported by it.
- 11ee555: Search for includes as vasm does. vasm looks in the directory it is run in, then in the directory of the main source, then the `-I` paths and `incdir`s, and never beside the file that names the include; the linter and the assembly server looked beside the including file and in the include paths only. They now also look in the directory of the main source (the file nothing else includes) and follow `incdir` directives, so an include named from the main source's directory by a file in another directory, or one reached through `incdir`, is found and its constants and macros are read. vasm's own order is tried first, so the file read is the one vasm opens, and looking beside the including file is kept only as a last resort, so nothing that was found before is lost. The search is one function shared by the linter, the linter server and the assembly server. Checked against vasm 1.9.
- 581f5d4: Apply the project config's `ignores`. A file it lists is not linted in the editor either: it gets no findings and no code actions, so opening a system include no longer shows every unused symbol in it. Patterns are relative to the config file, as on the command line. The file is still indexed for the constants and macros it provides.

  Add an **Ignore this file** quick fix on any finding. It adds the file to `ignores` in the config that applies, beside the existing entries and leaving the rest of the file as it was, and creates `m68k-lint.json` at the workspace root when there is none, for clients that can create a file as part of an edit. It is never offered for a file outside every workspace folder, such as a shared include, since a config would have to be written into a directory the project does not own.

- 36b3909: Read includes through the config's `includePaths`. A constant or macro defined in an include outside the workspace, such as a shared NDK file the assembler finds through `-I`, now resolves in the editor as it does on the command line. Open editors' unsaved text is used for those files too.
- 3d61532: Share the options that describe how the source is assembled. `processors`, `includePaths` and `caseSensitive` are read from `.m68krc.json` by the linter, its language server and the assembly server, layered under the tool's own config, and `-nocase`, `-I` and `-m` in the vasm arguments are read back as those options. The assembly server now passes `-nocase` to vasm when case is folded by setting, without repeating arguments already given, and warns when `caseSensitive: true` contradicts a `-nocase` argument. The linter CLI now honours `caseSensitive` in its config, which it previously ignored.

  The assembly server now finds `.m68krc.json` by walking up from the workspace folder, as the linter does, rather than only in the folder itself.

  Relative `includePaths` in `.m68krc.json` are taken from the file's directory by the assembly server too, so all three tools agree, and vasm is given the resolved paths.

- 9ca205d: Add `sourceRoot`, the directory relative paths in the source resolve from, to `.m68krc.json`, `m68k-lint.json` (where it overrides the shared file's) and `m68k.sourceRoot` in editor settings. vasm is run there instead of in each file's own directory, so a project whose includes are named from where its build runs (`include "lib/defs.i"`) no longer gets false include errors, and the linter and both language servers look there for includes. Unset keeps the previous behaviour.

  A relative `-I` in `vasm.args` is tried from the source root, where vasm is run, and then from the main source's directory, as vasm does, and the linter reads it the same way.

- 3d61532: Keep symbol case by default, as vasm does. `Foo` and `foo` are different symbols unless the assembler was given `-nocase`; the linter used to treat every name as case-insensitive, so two symbols differing only in case merged into one, giving a false conflict for constants, hiding unused labels, and letting a branch to `.Loop` land on `.loop`. Constants, labels, local labels and macros now keep their case throughout, and instruction, directive and register names are still matched without regard to case.

  A project assembled with `-nocase` says so: `caseSensitive: false` in `m68k-lint.json`, or in the assembly server's config, which also follows a `-nocase` among the vasm arguments when the setting is unset. 68kcounter's `parse` takes `{ caseSensitive: false }`. The assembly server re-reads every document when the setting changes. `m68k-parser` gains `symbolKey`, and `analyzeLocalLabelScopes` takes the option. Macro names in 68kcounter and the assembly server, which used to ignore case, now keep it like other symbols. `opt c-` in the source is not read yet.

### Patch Changes

- 36b3909: Report `portability/include-case` in the editor: an include whose case differs from the file on disk, with the path as it is on disk offered as a quick fix. Only computed when the rule is on.

## 0.3.0

### Minor Changes

- d29fda4: Add `suspicious/unused-global-label`, flagging a global label referenced nowhere in the project. Off by default and only checked when a project-wide reference index is available: a label with no reference the index can see may still be a linker-specified entry point or a hardware vector table entry placed by address rather than by name, neither of which is visible to source analysis. XDEF and XREF need no special handling -- their operands are ordinary symbol references, so an exported or imported name already counts as used. `_start` is exempt outright as the conventional linker entry point name.

  Add `buildProjectReferences` and thread an optional `ProjectReferences` index through `lintParsedFile`/`lintSource` and `RuleContext.projectReferences`, built from the same project scan `buildProjectSymbols` already does. Building it re-parses every project file on top of the constant index's own pass, so both the CLI and the language server now build it only when `needsProjectReferences(config)` says a live rule actually reads it -- in practice, only when `unused-global-label` itself is enabled. Project indexing overall can still be turned off with `projectSymbols: false`.

### Patch Changes

- a76bfa3: Share workspace file discovery (recursive walk, exclude-pattern matching) between the assembly and linter language servers via a new private `@m68k-lsp/workspace-files` package, instead of each maintaining its own implementation.

  No intended behaviour change for `m68k-lsp-server`. For `m68k-lint-langserver`, project indexing now respects real glob exclude patterns (previously a fixed set of skipped directory names with no way to configure it) via the same mechanism the assembly server already exposed through its own `exclude` setting; a hidden directory other than `.git` is no longer skipped unconditionally, since it is now covered by the same exclude-pattern default both servers share instead of a blanket dotfile rule.

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

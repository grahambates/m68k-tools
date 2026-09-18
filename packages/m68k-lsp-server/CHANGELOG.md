# Changelog

## 0.12.1

### Patch Changes

- a76bfa3: Share workspace file discovery (recursive walk, exclude-pattern matching) between the assembly and linter language servers via a new private `@m68k-lsp/workspace-files` package, instead of each maintaining its own implementation.

  No intended behaviour change for `m68k-lsp-server`. For `m68k-lint-langserver`, project indexing now respects real glob exclude patterns (previously a fixed set of skipped directory names with no way to configure it) via the same mechanism the assembly server already exposed through its own `exclude` setting; a hidden directory other than `.git` is no longer skipped unconditionally, since it is now covered by the same exclude-pattern default both servers share instead of a blanket dotfile rule.

## 0.12.0

### Minor Changes

- f57244d: #### Added

  - Register usage and availability analysis, register definition navigation, and
    register remapping and swapping, including registers passed as macro arguments.
  - Independent body indentation for conditional blocks, `rept` blocks and macro
    definitions through `indentConditional`, `indentRept` and `indentMacro`.
  - Formatter configuration discovery through `.m68k-format.json`.

  - Diagnostics for include files. `.i` files were excluded from vasm entirely,
    because assembling one on its own reports errors that exist only out of
    context. A program that includes it is assembled instead, and the messages
    belonging to the include are reported against it.
  - Diagnostics for unbalanced blocks: a `macro`, `rept` or conditional that is
    never terminated, and a terminator that closes nothing.
  - Syntax errors now carry a specific code and, where there is one, a hint.
    Previously every syntax problem was reported as "Parser error".
  - The workspace is indexed at startup, so find references and rename cover
    files that have not been opened. Results no longer change as tabs are
    opened.
  - `m68k.exclude` for paths to leave out of the index, on top of the built-in
    patterns for build output and dependency directories.

  #### Changed
  - Formatting is provided by the separate `m68k-formatter` library and CLI.
  - Workspace indexing prunes excluded directories instead of walking their contents.

  - Symbols resolve within an assembly unit - a file together with its include
    tree - rather than across the whole workspace. Two programs that share a
    header no longer see each other's labels.
  - Completion offers only symbols the file can actually reach.
  - Go to definition returns the nearest definition first, by distance through
    the include graph, where a name is defined more than once.
  - Parsing moved from tree-sitter to m68k-parser, removing the bundled grammar,
    its WebAssembly runtime and a hand-written parser for partial lines. The
    extension is now self-contained and about a quarter smaller.

  #### Fixed
  - Keep document and index state in sync across file changes, renames and deletes.
  - Treat register availability after subroutine calls as unknown.
  - Preserve correct formatting for whitespace-only lines.

  - Rename could edit unrelated programs that shared an include, and did so
    inconsistently: call sites were renamed without their definitions, leaving
    the other program referring to a label that no longer existed.
  - Formatting removed both colons from an exported label such as `foo::` when
    label colons were turned off.
  - The server could fail on a file watcher event that arrives without a
    filename.
  - Hover showed no declaration for a symbol defined in a file that was not
    open.
  - Labels containing macro placeholders, such as `.loop\@`, are no longer
    offered as symbols or counted as references. They are per-expansion names
    rather than definitions.
  - `pnpm run build-docs` had not been runnable: it required ts-node, which was
    not a dependency.
  - Parsing fixes, via m68k-parser: shift operators in an operand list, a
    parenthesised displacement before indexed addressing, `equr` aliases as
    index registers, `@` in symbol names, macro arguments that are not
    expressions, floating point literals, and C style comments after an operand.

- c40b89e: Add call hierarchy support: "Show Call Hierarchy" now lists incoming callers and outgoing calls for a routine, based on `bsr`/`jsr` instructions whose target is a resolvable label. Calls made through a register or other computed address are not shown, since their target cannot be determined statically.
- 6b04a74: Add inlay hints showing the evaluated value of constant assignments (`equ`, `fequ`, `=`, `set`) inline, for expressions beyond a bare decimal literal — a hex/binary/octal literal still gets a decimal hint. Enabled by default via the new `inlayHints.enabled` setting.
- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.
- ac834aa: Preview register-remapping warnings for newly invalid operand forms, such as address registers in MOVEQ or byte instructions and data registers used as indirect address bases. Display warnings alongside mapping conflicts while keeping Apply available. Valid address/data substitutions and index registers remain supported. Validation matches complete documented operand alternatives and addressing-mode tables, with explicit checks for address bases and byte operations. Unknown documentation notation is left unchecked; this is not a full assembly of the program.

  Cover base-68000 operand notation, branch targets, absolute addresses, arithmetic operand-pair restrictions and special-register MOVE forms. Preserve all EORI forms when generating instruction documentation.

  Continue validating explicit instructions when macro analysis is incomplete or references cannot safely be edited, preserving concrete warnings alongside a partial-validation notice.

### Patch Changes

- e8314fe: Trigger format-on-type on `#`, `:`, `=` and `)` in addition to the existing trigger characters, so immediate-mode operands, labels, direct assignments and closed addressing modes are reformatted as you type them.
- e70692d: Warn when remapping a register whose value is read before it is written in the selected scope, so callers or initialisation outside the scope can be updated. Keep the proposed edits available to apply.
- 31c2f3e: Only trigger signature help on `,` rather than on every space, tab or period. Auto-popping up after each keystroke while typing an instruction's first operand obscured the surrounding code; it still triggers when moving to a later operand, and remains available on demand.
- Updated dependencies [ade45b3]
- Updated dependencies [79d0e32]
- Updated dependencies [0ea9bcc]
- Updated dependencies [a9c19ea]
- Updated dependencies [555bafb]
- Updated dependencies [f77f9fc]
- Updated dependencies [b86ae11]
  - m68k-parser@2.0.0
  - m68k-formatter@0.2.0

## [0.11.2] - 2024-07-24

### Fixed

- Scoped local label syntax [#22](https://github.com/grahambates/m68k-lsp/issues/22)
- Parsing expressions containing chevrons. Regression caused by quoted args support.

## [0.11.1] - 2024-06-28

### Fixed

- Document links should be URIs, not file paths [#14](https://github.com/grahambates/m68k-lsp/issues/14)

## [0.11.0] - 2024-06-28

### Added

- Project specific settings overrides via `.m68krc.json`

### Fixed

- Support multiple macro args in labels [#15](https://github.com/grahambates/m68k-lsp/issues/17)
- Formatting options documentation defaults were incorrect [#17](https://github.com/grahambates/m68k-lsp/issues/16)

## [0.10.0] - 2024-06-24

### Changed

- Support quoted macro arguments
- Support macro qualifiers [#17](https://github.com/grahambates/m68k-lsp/issues/17)

## [0.9.2] - 2023-09-15

### Fixed

- Upgrade web-tree-sitter to fix 'invalid URL' error in vscode

## [0.9.1] - 2023-05-26

### Fixed

- Merge existing config on change [#9](https://github.com/grahambates/m68k-lsp/issues/9)
  - Fixes Helix support

## [0.9.0] - 2022-10-07

### Changed

- Better alignment with tabs. Positions are now always column numbers (i.e. spaces) so no nasty surprises when changing
  indent modes.

### Fixed

- Formatting on comment blocks for hover and autocomplete. These are now correctly escaped into markdown with line breaks
  intact.
- Incorrect help string on a vscode setting

## [0.8.1] - 2022-08-07

### Fixed

- Update tree-sitter-m68k to v0.2.7
  - allows square brackets
  - adds support for scaled indexes to address [#7](https://github.com/grahambates/m68k-lsp/issues/7)

## [0.8.0] - 2022-07-14

### Added

- VS Code problem matcher for vasm output
- Format range
- Format on type

### Fixed

- wasm fetch error in node 18
- symbol hover definition from correct document

## [0.7.5] - 2022-07-08

### Fixed

- Nested blocks syntax error in tree-sitter-m68k

## [0.7.4] - 2022-07-05

### Fixed

- syntax: add missing `ifb`/`ifnb` conditionals
- syntax: handle unbalanced quotes

## [0.7.3] - 2022-06-29

### Added

- Syntax support for escape chars in strings and unquoted paths

### Fixed

- Handle double colon for external labels in line parser
- Don't format text inside REM or after END
- Various parser fixes in tree-sitter-m68k

## [0.7.2] - 2022-06-27

### Fixed

- Parser errors on REM and empty blocks

## [0.7.0] - 2022-06-22

### Changed

- More control over standalone comment position [#5](https://github.com/grahambates/m68k-lsp/issues/5)

## [0.6.3] - 2022-06-18

### Fixed

- Handle macro arguments in labels, mnemonics, sizes and operands [#4](https://github.com/grahambates/m68k-lsp/issues/4)

## [0.6.2] - 2022-05-18

### Fixed

- Fix startup issues (in Emacs and possibly other lsp-clients) by [@themkat](https://github.com/themkat)

## [0.6.1] - 2022-05-13

### Fixed

- Replace bad wasm build

## 0.6.0 - 2022-15-12

### Added

- VASM diagnostics

### Changed

- Incremental tree-sitter updates not working correctly in neovim - disabled for now.
- Better merging of config with defaults
- Upgade tree-sitter-m68k

## [0.5.0] - 2022-05-08

### Added

- `autoExpand` option for alignment formatter. This allows automatic adjustment of component positions to allow for
  elements which exceed the available space.
- Operand spacing formatter. Add or remove space between operands as allowed in VASM with `-spaces` option.

### Changed

- Defaults for alignment now use spaces. This is more reliable as tab alignment can easily break if editor tab width
  doesn't match config.

### Fixed

- Handle string operands with spaces [@dansalvato](https://github.com/dansalvato).

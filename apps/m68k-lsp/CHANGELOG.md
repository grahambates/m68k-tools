# m68k-lsp

## 0.13.0

### Minor Changes

- Release with language server 0.13: a shared `.m68krc.json` project config, with a JSON schema for it and for `.m68k-format.json`; new `sourceRoot`, `escapeSequences` and `inferIncludePaths` settings; case-sensitive symbols; vasm-style include search, with guessed include paths offered as quick fixes; the statement in an `iif` understood; and fewer redundant activation events.

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

- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.
- ac834aa: Preview register-remapping warnings for newly invalid operand forms, such as address registers in MOVEQ or byte instructions and data registers used as indirect address bases. Display warnings alongside mapping conflicts while keeping Apply available. Valid address/data substitutions and index registers remain supported. Validation matches complete documented operand alternatives and addressing-mode tables, with explicit checks for address bases and byte operations. Unknown documentation notation is left unchecked; this is not a full assembly of the program.

  Cover base-68000 operand notation, branch targets, absolute addresses, arithmetic operand-pair restrictions and special-register MOVE forms. Preserve all EORI forms when generating instruction documentation.

  Continue validating explicit instructions when macro analysis is incomplete or references cannot safely be edited, preserving concrete warnings alongside a partial-validation notice.

- 480ea7e: Preview pending register mappings with temporary inline destination annotations. Highlight conflicts and validation issues in amber with hover explanations, without modifying source text. Clear previews when mappings are reset, applied successfully, or their editor scope changes.

### Patch Changes

- 555bafb: - `m68k-parser` now recognises the `db`, `dl`, `fopt` and `radix` directives, which were documented but missing from the directive list.
  - The assembly syntax grammar (`m68k-lsp`) now highlights floating-point literals, the full set of special/control and FPU registers, all built-in symbols (`__CPU`, `__VASM`, etc.), and no-operand directives used for trailing-comment detection (`endm`, `endif`, `else`, etc.). It also fixes the line-comment `*` rule to no longer swallow parenthesised, bracketed or braced expressions containing multiplication, and corrects macro-parameter escape highlighting to recognise single-letter parameters (`\a`).
- cb4e955: Highlight usage lines in the current editor scope when hovering over a register row or keyboard-focusing its name in the remapping panel. Highlights clear on pointer leave, blur or scope changes and remain separate from mapping previews.

---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

#### Added

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

# m68k-lsp

## 0.15.0

### Minor Changes

- 472a183: Register analysis resolves `equr`, `equrl` and `reg` aliases, including ones defined in included files, so uses such as `move.w count,d1` or `(ptr)+` count towards the aliased register's usage and availability. Register usage results report them with the reference kind `alias`, and remapping or swapping a register used through an alias is refused as an unsupported reference. Alias definition lines no longer count as uses of their registers. Hovering an alias shows the register's description.
- 09e2109: Hovering a data or address register shows what it holds, read from routine header comments (including `Inputs:`/`Outputs:`/`Trashes:` sections), comments on assignments, symbolic source operands such as `lea SomeTable,a0`, and the documented outputs of called routines.
- 25d7abf: Register hover descriptions follow the block's control flow instead of source order. Where branches or a loop join, a description is kept only if every path reaching the line agrees on it.
- e6afc18: Available registers report how long they stay free: register usage results include `availableUntilOverwritten` and `availabilityRanges`, every run of lines in the scope where the register is free or its availability is unknown, with free runs marked if they stay free only until a later write. The remapping panel shows registers free after the cursor only until a later overwrite in orange, and unknown availability in grey italic in place of the `availability unknown` label. Hovering a row marks all of the register's runs in green, orange or grey; each run starts and ends on code, leaving out labels at its edges. A documented output is now available when every path overwrites it before returning.
- 472a183: Hovering a register list, such as the `d0-d2/a0` in `movem`, shows the description of each register in it that has one. With the cursor on the local label of a fragment the block's flow never reaches, the scope covers that fragment instead of being empty.
- 25d7abf: Register liveness follows `bsr`/`jsr` calls through subroutines in the same file, including nested and recursive calls, instead of treating every register a subroutine touches as used. A register the subroutine overwrites before reading is free before the call. Calls to routines in other files use their header comment's `Inputs:`, `Outputs:` and `Trashes:` as a contract.
- e6afc18: Register liveness tracks how many bits of a register later code reads, so a byte or word write frees the register before it when only the bits it replaces are read afterwards. There is no scope between blocks, such as on blank lines, comments or data after a return, instead of the scope running into the next block, and the remapping panel says so.
- 2980900: Register availability uses liveness rather than any later access. A register is available when no path from the cursor reads it before overwriting it in full, following macro expansions in order. Byte and word writes to data registers, and conditional writes, do not count as overwrites.
- 2cd4b0a: Registers documented as outputs in a routine's header comment are marked `output` in register usage results and the remapping panel, and are no longer reported as available.
- 2cd4b0a: The register remapping panel shows the lines where each register is first and last used in scope, as links that jump to them. Registers available after the cursor are shown in green instead of being labelled `available`. Register usage results include the last use as `lastUse`.
- 795c636: The register remapping panel shows the scope's first and last lines as links that jump to them, matching the register usage links.
- 25d7abf: The register analysis scope is now called a block: the code from a non-local label to where its control flow ends. Messages in the remapping panel and register commands say "block" instead of "routine". The private protocol's `m68k/routineRange` request is now `m68k/blockRange`.
- aa46393: Register analysis recognises registers a block saves on the stack and restores with `.l` `movem` or `move`. A subroutine that preserves a register no longer counts as using it, so the register stays available across the call. A preserved register is not marked as an input, and its hover description comes back after the restore.
- 472a183: A call to a macro with no definition the workspace can find, directly or from inside another macro, makes register availability unknown from that point instead of counting only the registers passed to it. Register remapping warns about such calls in the scope, since the registers they use cannot be checked.
- 39c77df: Register remapping panel usage highlights now distinguish lines that write the register from lines that only read it, using the editor's write-occurrence highlight colour, and mark both in the overview ruler.
- a913499: Hovering a routine's label, at its definition or in a `bsr`/`jsr`, summarises the registers it reads and modifies as its callers see them, following the subroutines it calls, for example `Reads D0/A0 · Modifies D0–D1/A0`. Changes a stack restore undoes are not counted as modifications.
- 795c636: The scope used by register analysis and the remapping panel follows control flow from its non-local label instead of ending at the first `rts`. Code after a conditional early return, and the targets of local jump tables, are now part of the scope. Branches to other non-local labels are treated as tail calls.

### Patch Changes

- 2980900: Register availability follows the branch on the cursor line, so registers used in a loop are no longer reported as available when the cursor is on the loop's closing `dbf`, `bne` or `bra`. With the cursor on an early `rts`, registers used only after it are now available.
- a913499: Register lists with ranges that span data and address registers, such as `d0-a6` in `movem.l d0-a6,-(sp)`, expand as vasm assembles them: through D0-D7 then A0-A7, with the ends in either order. They previously expanded to no registers. Lists may also name `sp`, and each register is listed once, in MOVEM mask order. The new `parseRegisterList` export expands such a list from text.
- 472a183: Register liveness accounts for control flow inside macro expansions. A macro with labels, branches or returns of its own no longer counts its writes as definite overwrites. Its branches to the caller's labels and its returns are followed from the call, and a subroutine called inside a macro makes availability unknown instead of being ignored.
- a913499: Registers stashed on the stack at several points in a routine are recognised: each restore pairs with the nearest earlier save of the register, instead of a register only being treated as preserved when the routine saves it exactly once.
- 03d5843: A routine's register summary no longer says it may modify any register when code it runs can't be analysed but registers are saved on the stack around that code. It names the registers that could still change, such as `Modifies possibly D0–D1/A0–A1` for a call inside a `d2-d7/a2-a6` save. This includes a branch that can't be resolved, such as a tail call into another file or `jmp (a0)`, in the routine or in a subroutine it calls.

  After such a branch, register availability is now unknown rather than unavailable, and a routine's summary says it possibly reads other registers there rather than listing them as read.

## 0.14.0

### Minor Changes

- c2f9966: Limit the default register analysis scope to the macro body when the cursor is inside a macro definition, from `macro` to `endm`, as a routine runs from its label to its return. Labels and returns inside a macro body no longer start or end the routine scope around the definition.

### Patch Changes

- 1877d65: Resolve includes again once workspace indexing finishes, so that an include found relative to its main source connects even when the including file was indexed first. Definitions, references and hover in such files no longer depend on the file being open.
- 305ff55: Index workspace files under the same URIs the editor and include resolution use. Files under paths containing characters such as spaces, parentheses or `@` are no longer indexed twice, which duplicated their references and symbols.
- 83ca493: Go to definition, find references, document highlights and rename work on macro calls again, including a call made by an `iif` statement. A call's mnemonic was not recorded as a reference to the macro after the symbol table moved to the m68k-parser AST, so the cursor on a call found nothing.

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

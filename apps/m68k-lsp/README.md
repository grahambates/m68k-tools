# Motorola 68000 Assembly

Adds language support for Motorola 68000 Assembly to Visual Studio Code.

## Features:

- Syntax highlighting
- Semantic highlighting for labels, constants, variables, macros, register aliases and sections
- Decimal and hexadecimal values on hover for resolved constants, `rs`/`so`/`fo` offsets and operand expressions, including constants defined later in the source
- Dimming for conditional assembly with known conditions
- Snippets
- Auto-completion:
  - Instruction mnemonics
  - Assembler directives
  - Registers
  - Symbols
  - Label definitions: labels the code uses but does not define yet
- Code Linting
  - Parser errors
  - Processor support
- Code Folding
- Document Formatting
- Document Highlights
- Document Links
- Document Symbols
- Used/unused data and address registers for a selected range
- Swap two registers throughout a selected range
- Register remapping view
- Find References
- Go to definition
- Call Hierarchy
- Peek Macro Expansion
- Hover
  - Instruction/directive documentation
  - Symbol info
  - Data/address register descriptions from comments and assignments
- Multiple workspaces
- Rename Symbols
- Update `include` and `incbin` paths on file and folder rename or move
- Signature Help
- Problem matching for vasm output
- Build tasks using bundled or native vasm

## Language server

This extension is based on [m68k-lsp-server](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-lsp-server#readme), which provides language features to
other LSP supporting editors.

## Changelog

ChangeLog is located [here](https://github.com/grahambates/m68k-tools/blob/main/packages/m68k-lsp-server/CHANGELOG.md)

Requires VS Code 1.101 or later. For local development, open the monorepo root and select **Assembly: Extension** in Run and Debug.

Pressing Enter in an assembly label starts a new line even when the suggestion list is open, so a new label is kept as typed. Tab accepts the highlighted suggestion, such as a label already used by a branch but not yet defined. In mnemonics and operands, Enter follows VS Code’s `editor.acceptSuggestionOnEnter` setting.

### Build with vasm

Add a task to `.vscode/tasks.json` to build an entry point with the bundled assembler. This example assembles `src/main.s` into a raw binary in the workspace folder.

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build main with vasm",
      "type": "vasm",
      "args": ["-Fbin", "-o", "main.bin", "src/main.s"],
      "group": { "kind": "build", "isDefault": true },
      "problemMatcher": "$vasm"
    }
  ]
}
```

Run **Tasks: Run Build Task**. To use a native assembler, set `"assembler": "native"` in the task. It uses `m68k.vasm.binPath` unless you supply a task-level `binPath`. Specify any include directories, CPU options, and output format in the task's arguments. The default `$vasm` problem matcher, shown explicitly above, resolves relative diagnostic paths from the task's workspace folder.

### Operand completion and signature help

The current size suffix and operands help select a matching instruction form. For example, after `move.l usp,`, completion offers address registers and matching aliases. Signature help selects the corresponding form and keeps the documented alternatives available.

### Conditional assembly

The editor dims branches that the language server can rule out using numeric expressions and earlier assignments in the same file and known constants from resolved direct includes. It uses `-D` flags from `vasm.args` and recognises simple `ifnd` defaults when no earlier definition is possible. Other build flags, unresolved includes and macro arguments can leave a condition undecided. The PUAE Debugger can use the vasm listing from a debug build to shade those branches when the listing provides enough evidence.

### Semantic highlighting

Themes with semantic highlighting enabled can style labels, constants, variables, macros, register aliases and sections. References use the kind of their resolved definition, including definitions in includes. To customize the colors, use `editor.semanticTokenColorCustomizations` with selectors such as `label:m68k`, `variable.readonly:m68k`, `macro:m68k`, or `register:m68k`.

### Peek Macro Expansion

Hover over a macro name at a call site to see its expansion with arguments substituted.

Place the cursor on a macro call and run **M68k: Peek Macro Expansion** from the Command Palette or the editor context menu. The read-only tab shows the macro body with the call's arguments substituted. Follow the definition link on the first line to jump to the macro, including when it is defined in an include file.

The preview follows known nested calls and shows their call sites as comments. It shows conditional and repeat directives as written after substitution and leaves assembler-generated identifiers such as `\@` visible. An incomplete expansion is marked in the preview.

### Register analysis scope

Register commands and the remapping view work on the selection. Without one, the scope is the block around the cursor. A block starts at the previous non-local label and covers every line its control flow reaches from there:

- Flow falls through to the next line, including into a later non-local label, and follows branches to local labels. Code after a conditional early return is therefore part of the block. Every non-local label starts a new block.
- An unconditional `rts`, `rte`, `rtr`, `bra` or `jmp` ends a path. A branch or jump to a non-local label is treated as a tail call and not followed.
- An indexed jump such as `jmp .table(pc,d0.w)` reaches every `bra`/`jmp` or `dc` entry of the table at its target, and the local labels those entries name. A jump with no named target, such as `jmp (a0)`, is assumed to continue into the code after it.

If the cursor is on code the block's flow never reaches, or on its label, such as a fragment entered from elsewhere, the scope runs to the end of that code's own flow instead. Blank lines, comments and data between blocks have no scope; select lines to analyse them. Inside a macro definition the scope is the macro body, from `macro` to `endm`; labels and returns in a macro body do not start or end a block around it.

### Register descriptions

Hovering a data or address register shows what it holds at that point in the block, where that can be read from the source:

- A routine header: comment lines directly above the block's label, such as `; d0 = frame count`. `d0: …`, `d0 - …`, `d0 …`, `d0.w = …` and lists such as `d0-d2/a0 = …` are also recognised. `Inputs:`, `Outputs:` and `Trashes:` headings group the entries, and lines before any heading are taken as inputs.
- A comment naming the register, such as `move.w #1,d0 ; d0 = frame count`.
- A comment on a line that overwrites only that register, such as `move.w #1,d0 ; frame count`. The hover marks this as inferred.
- A symbolic source operand, such as `lea SomeTable,a0` or `move.l #FRAMES,d0`.
- A `bsr`/`jsr` to a routine whose header lists the register as an output. A routine that lists it as trashed clears the description.

Hovering an `equr` alias for a register shows the same description as the register, below the alias's definition. Hovering a register list, such as `d0-d2/a0` in `movem`, shows the description of each register in it that has one.

Hovering a non-local code label, where it's defined or in a `bsr`/`jsr`, summarises what the routine does with registers, as its callers see them, such as `Reads D0/A0 · Modifies D0–D1/A0`:

- It reads registers whose values it uses before writing them.
- It modifies registers it may leave changed when it returns, including through the subroutines it calls. A change a stack restore undoes doesn't count.

Where it runs code that can't be analysed, the summary says it may read or modify others. A register saved on the stack around that code is put back, so it's left out of what the routine may modify, and the summary names the registers that remain, such as `Modifies possibly D0–D1/A0–A1` for a library call inside a `d2-d7/a2-a6` save. The stack pointer is left out, on the assumption that pushes and pops balance. Subroutines beyond the analysis limit (see [Register availability](#register-availability)) count as code that can't be analysed. The summary is available for routines in files the server has open.

A description holds until the register is overwritten outright. Restoring a register saved on the stack brings back the description it had when it was saved. Read-modify-write instructions such as `addq` keep it. Descriptions follow the block's control flow. Where branches join, a description is kept only if every path into that line agrees on it, so one set in a single branch doesn't carry past the join. The same applies at the top of a loop.

### Register remapping warnings

The remapping view previews warnings for newly invalid register operand forms alongside destination conflicts. Both are advisory: Apply remains available. Valid substitutions between data and address registers are allowed. The preview matches complete operand alternatives from the instruction documentation, including register classes and source/destination addressing modes. Unrecognised documentation forms are left unchecked. It also checks address bases, byte-sized address-register use and newly introduced parser errors. It warns about calls in the scope to macros with no definition the workspace can find, since the registers they use can't be checked. It does not assemble the complete program or prove that its behaviour is unchanged.

If macro analysis is incomplete or includes references that cannot safely be edited, the preview still validates explicit instructions and indicates the unchecked references. The existing restrictions on applying an incomplete edit plan remain in effect.

### Register availability

Registers that are free to reuse after the cursor have their access summary shown in green, or in orange when they are free only until a later write overwrites them. It is grey italic when availability is unknown, because the code after the cursor includes a call or macro that could not be analysed. Hover over it for the full status. Hovering a register row also marks every run of lines in the scope where the register is free, with a bar at the line's edge alongside the read and write marks. This includes runs before the cursor and inside loops. A run starts and ends on code, so it only covers a label that it carries on past. Each run is green where nothing later touches the register, orange where it stays free only until a later write, or grey where availability is unknown. The panel's text colour describes the register after the cursor line. A register is free when no path the code can take from the cursor reads it before overwriting it in full:

- The flow follows branches, including back round a loop, and the lines a macro call expands to, in order. Branches inside an expansion aren't followed step by step. If an expansion has labels, branches or returns of its own, none of its writes counts as an overwrite. Its branches to labels outside it, and its returns, are followed from the call. A `bsr` or `jsr` inside a macro makes the answer unknown.
- Registers named through `equr`, `equrl` or `reg` aliases count as the registers they stand for, where an alias is used as a whole operand or as an addressing mode's base or index register. A register used through an alias can't be remapped or swapped in place; change its alias definition instead.
- Bits are tracked by width. A read needs the low byte, word or long word of the register, at the operation's size: word when none is given, the index size for an index register, and all 32 bits for an address register. A write frees the earlier value once it replaces every bit still to be read. So a `.w` write followed only by `.w` reads frees the register before it, but not if a `.l` read follows. Writes to address registers, `moveq`, `lea` and `movem` loads replace all 32 bits. A write under `iif` or inside an `if` block may not happen, so it replaces nothing.
- A `bsr` or `jsr` to a subroutine in the same file is followed through the subroutine, including nested and recursive calls. A register the subroutine overwrites before reading is free before the call, and one it leaves alone carries on to the code after the call. Following subroutines is limited so that the analysis stays responsive. In a large program where many routines call each other, subroutines left over once the limit is reached are taken at their header's word, as for a call to another file. Without a header, the answer is unknown.
- A register a block saves on the stack and restores, with a `.l` `movem` or `move` to `-(sp)` and back from `(sp)+`, is treated as kept rather than used. Its value at the save is what comes back at each restore, so a subroutine that preserves a register doesn't count as using it, and a preserved register isn't marked as an input. Each restore pairs with the nearest earlier save of that register between the same non-local labels, so a register can be stashed at several points in a routine, and a save can have several restores, as on early exits. A push with no restore, such as an argument for a call, keeps the usual treatment.
- A call to a routine in another file uses its header comment as a contract. Registers under `Inputs:` are read, those under `Outputs:` or `Trashes:` are overwritten, and others are kept. A header must document at least one register to count.
- A call with no target that can be resolved and no documented header makes the answer unknown. So does a macro that can't be fully expanded, or one with no definition the workspace can find, including one called from inside another macro. The registers passed to an undefined macro count as read.

Registers the block's routine header lists under `Outputs:` are labelled `output` in the panel. A return counts as reading them, so an output is only available when every path overwrites it before returning.

Each row in the remapping panel shows the lines where the register is first and last used in scope, such as `L12–30`, or just `L12` when both are on one line. Click either number to move the cursor there. The scope at the top of the panel shows its first and last lines in the same way, such as `Scope: Draw · L5–31`. When the scope comes from a selection, the editor scrolls to the line and keeps the selection, so the scope does not change.

Hover over a register row in the remapping panel to highlight its usage lines in the current scope. Usage lines share the occurrence highlight background and get a bar at their left edge, like the free-line runs: purple where the line may write the register, blue where it only reads it. Both are also marked in the overview ruler. Highlights clear when the pointer leaves. Keyboard focus also shows the preview, clearing on blur. Usage highlights are separate from mapping previews and clear on Reset or a scope change.

Pending register remappings are previewed in the source with inline destination annotations. Amber highlights indicate destination conflicts or validation issues; hover for details. The preview does not edit the source and clears on Reset, successful Apply, or an editor-scope change.

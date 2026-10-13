# Motorola 68000 Assembly

Adds language support for Motorola 68000 Assembly to Visual Studio Code.

## Features:

- Syntax highlighting
- Snippets
- Auto-completion:
  - Instruction mnemonics
  - Assembler directives
  - Registers
  - Symbols
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
- Hover
  - Instruction/directive documentation
  - Symbol info
  - Data/address register descriptions from comments and assignments
- Inlay Hints
  - Evaluated value of constant assignments (see [68kcounter](https://marketplace.visualstudio.com/items?itemName=gigabates.68kcounter) for cycle/size annotations)
- Multiple workspaces
- Rename Symbols
- Signature Help
- Problem matching for vasm output

## Language server

This extension is based on [m68k-lsp-server](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-lsp-server#readme), which provides language features to
other LSP supporting editors.

## Changelog

ChangeLog is located [here](https://github.com/grahambates/m68k-tools/blob/main/packages/m68k-lsp-server/CHANGELOG.md)

Requires VS Code 1.101 or later. For local development, open the monorepo root and select **Assembly: Extension** in Run and Debug.

### Register analysis scope

Register commands and the remapping view work on the selection. Without one, the scope is the routine around the cursor. It starts at the previous non-local label and covers every line the routine's control flow reaches from there:

- Flow falls through to the next line, including into a later non-local label, and follows branches to local labels. Code after a conditional early return is therefore part of the routine.
- An unconditional `rts`, `rte`, `rtr`, `bra` or `jmp` ends a path. A branch or jump to a non-local label is treated as a tail call and not followed.
- An indexed jump such as `jmp .table(pc,d0.w)` reaches every `bra`/`jmp` or `dc` entry of the table at its target, and the local labels those entries name. A jump with no named target, such as `jmp (a0)`, is assumed to continue into the code after it.

If the cursor is on code the routine's flow never reaches, the scope ends at the next unconditional return after the cursor instead. Inside a macro definition it is the macro body, from `macro` to `endm`; labels and returns in a macro body do not start or end a routine around it.

### Register descriptions

Hovering a data or address register shows what it holds at that point in the routine, where that can be read from the source:

- A routine header: comment lines directly above the routine's label, such as `; d0 = frame count`. `d0: …`, `d0 - …`, `d0 …`, `d0.w = …` and lists such as `d0-d2/a0 = …` are also recognised. `Inputs:`, `Outputs:` and `Trashes:` headings group the entries, and lines before any heading are taken as inputs.
- A comment naming the register, such as `move.w #1,d0 ; d0 = frame count`.
- A comment on a line that overwrites only that register, such as `move.w #1,d0 ; frame count`. The hover marks this as inferred.
- A symbolic source operand, such as `lea SomeTable,a0` or `move.l #FRAMES,d0`.
- A `bsr`/`jsr` to a routine whose header lists the register as an output. A routine that lists it as trashed clears the description.

A description holds until the register is overwritten outright. Read-modify-write instructions such as `addq` keep it. Lines are followed in source order within the routine, so branches are not taken into account.

### Register remapping warnings

The remapping view previews warnings for newly invalid register operand forms alongside destination conflicts. Both are advisory: Apply remains available. Valid substitutions between data and address registers are allowed. The preview matches complete operand alternatives from the instruction documentation, including register classes and source/destination addressing modes. Unrecognised documentation forms are left unchecked. It also checks address bases, byte-sized address-register use and newly introduced parser errors; it does not assemble the complete program or prove that its behaviour is unchanged.

If macro analysis is incomplete or includes references that cannot safely be edited, the preview still validates explicit instructions and indicates the unchecked references. The existing restrictions on applying an incomplete edit plan remain in effect.

Registers that are free to reuse after the cursor have their access summary shown in green; hover over it for the full status. A register is free when no path the code can take from the cursor reads it before overwriting it in full:

- The flow follows branches, including back round a loop, and the lines a macro call expands to, in order.
- Only a whole-register write ends a path. That means a write to an address register, `moveq`, `lea`, `movem`, or a `.l` write to a data register. A `.b` or `.w` write keeps the upper bits, so it counts as a use. So does a write under `iif` or inside an `if` block, since it may not happen.
- Any register a called subroutine in the same file touches counts as used. A call that can't be resolved, or a macro that can't be fully expanded, makes the answer unknown.

Registers the routine's header comment lists under `Outputs:` are labelled `output` in the panel. They are never reported as available, because their value at the cursor is what the routine returns unless something later overwrites it.

Each row in the remapping panel shows the lines where the register is first and last used in scope, such as `L12–30`, or just `L12` when both are on one line. Click either number to move the cursor there. The scope at the top of the panel shows its first and last lines in the same way, such as `Scope: Draw · L5–31`. When the scope comes from a selection, the editor scrolls to the line and keeps the selection, so the scope does not change.

Hover over a register row in the remapping panel to highlight its usage lines in the current scope. Lines that may write the register use the stronger write-occurrence highlight; lines that only read it use the normal occurrence highlight. Both are also marked in the overview ruler. Highlights clear when the pointer leaves. Keyboard focus also shows the preview, clearing on blur. Usage highlights are separate from mapping previews and clear on Reset or a scope change.

Pending register remappings are previewed in the source with inline destination annotations. Amber highlights indicate destination conflicts or validation issues; hover for details. The preview does not edit the source and clears on Reset, successful Apply, or an editor-scope change.

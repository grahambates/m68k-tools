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

Register commands and the remapping view work on the selection. Without one, the scope is the routine around the cursor, from the previous non-local label to the next unconditional `rts`, `rte` or `rtr`. Inside a macro definition it is the macro body, from `macro` to `endm`; labels and returns in a macro body do not start or end a routine around it.

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

Registers that are free to reuse after the cursor, because nothing reachable from it touches them, have their access summary shown in green. Hover over it for the full status.

Registers the routine's header comment lists under `Outputs:` are labelled `output` in the panel. They are never reported as available, because their value at the cursor is what the routine returns unless something later overwrites it.

Each row in the remapping panel shows the lines where the register is first and last used in scope, such as `L12–30`, or just `L12` when both are on one line. Click either number to move the cursor there. When the scope comes from a selection, the editor scrolls to the line and keeps the selection, so the scope does not change.

Hover over a register row in the remapping panel to highlight its usage lines in the current scope. Lines that may write the register use the stronger write-occurrence highlight; lines that only read it use the normal occurrence highlight. Both are also marked in the overview ruler. Highlights clear when the pointer leaves. Keyboard focus also shows the preview, clearing on blur. Usage highlights are separate from mapping previews and clear on Reset or a scope change.

Pending register remappings are previewed in the source with inline destination annotations. Amber highlights indicate destination conflicts or validation issues; hover for details. The preview does not edit the source and clears on Reset, successful Apply, or an editor-scope change.

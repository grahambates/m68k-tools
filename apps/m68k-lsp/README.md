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
- Hover
  - Instruction/directive documentation
  - Symbol info
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

### Register remapping warnings

The remapping view previews warnings for newly invalid register operand forms alongside destination conflicts. Both are advisory: Apply remains available. Valid substitutions between data and address registers are allowed. The preview matches complete operand alternatives from the instruction documentation, including register classes and source/destination addressing modes. Unrecognised documentation forms are left unchecked. It also checks address bases, byte-sized address-register use and newly introduced parser errors; it does not assemble the complete program or prove that its behaviour is unchanged.

If macro analysis is incomplete or includes references that cannot safely be edited, the preview still validates explicit instructions and indicates the unchecked references. The existing restrictions on applying an incomplete edit plan remain in effect.

Pending register remappings are previewed in the source with inline destination annotations. Amber highlights indicate destination conflicts or validation issues; hover for details. The preview does not edit the source and clears on Reset, successful Apply, or an editor-scope change.

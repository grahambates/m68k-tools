# @m68k-lsp/assembly-options

Private, shared options for how a project's source is assembled, read once so the tools agree: the processors it targets, the directory the assembler is run in (`sourceRoot`), the directories it searches for includes, and whether symbol names keep their case.

These are the facts that change what the source means, and none of them is reliably in the source itself: they are given to vasm as arguments (`-I`, `-nocase`, `-m68020`). They are read from `.m68krc.json`, and from the `vasm.args` in it, and each tool lets its own config override them. The reverse also lives here: the vasm arguments that follow from the options, for a tool that runs vasm.

Tool-specific settings stay with the tool. This is only the shared part.

[MIT licensed](LICENSE.md).

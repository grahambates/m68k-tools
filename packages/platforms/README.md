# @m68k-lsp/platforms

Private, shared knowledge of the machines 68000-family code is written for, so the linter and the language server agree on it. So far that is the Amiga's custom chip registers: their names, offsets from `$DFF000`, whether each is read or written, and the symbols the Amiga includes name them by.

Omission is safe and commission is not: a register is listed only where its direction has been checked against the Amiga Hardware Reference Manual, because the linter reports a wrong-direction access as an error.

[MIT licensed](LICENSE.md).

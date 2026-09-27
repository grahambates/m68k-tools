---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Added `correctness/amiga-dma-outside-chip-ram`, an error on the Amiga platform when a copper, audio, blitter, bitplane, sprite or disk DMA pointer is set to a label in a section that is not in chip RAM. It covers a long MOVE of `#label` into the pointer, or of a register loaded with `lea label,An`, `lea label(pc),An`, `move.l #label,Rn` or a copy of one, following the register back through the code before it. A section with no memory attribute is reported with high confidence: AmigaDOS loads it into fast RAM whenever there is any, so the code works on a chip-RAM-only machine and fails on an expanded one. An explicitly fast section is reported as certain. The suggestion names the section directive to change to a `_c` type. Pointers poked into a copper list, addresses computed at run time, and loads before a subroutine call or an opaque macro are not followed.

The Amiga custom-register rules now also recognise the long names for pointer pairs, such as `COP1LC`, `AUD0LC`, `BLTDPT`, `BPL1PT` and `SPR0PT`, as well as the `H`/`L` halves.

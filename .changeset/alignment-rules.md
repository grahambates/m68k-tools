---
"m68k-lint": minor
---

Add `suspicious/odd-address-access` (error) and `suspicious/missing-even`. The first flags a word or long access at an address that is provably odd: a numeric or `equ` address, an address register holding a known value, or a label on byte data whose position follows from the data before it. The second flags an instruction, or word-sized data on a 68000/68010, placed after an odd number of bytes such as `dc.b "abc"`. Both stay silent once the position cannot be worked out (after INCLUDE, INCBIN, a macro or a conditional block) and are restarted by `even`, `cnop`, `align` and new sections. Later processors permit unaligned data access, so those checks apply only when a 68000, 68010 or CPU32 is a target.

---
"m68k-parser": minor
---

Parse square brackets as expression grouping, as the Asm-One family of assemblers (AsmPro, TRASH'M-One) allows: `moveq #[end-start]/2-1,d7`, `ds.b [SIZE]*4` and `(base+[8+4]*4,a4)`. vasm rejects this form, so it is an extension beyond the vasm dialect. A group must close with its own kind of bracket. Memory indirect addressing is unaffected: an operand starting `([` is memory indirect when the `]` is followed by `,` or `)`, and a bracketed displacement such as `([a+b]*2,a0)` otherwise.

Read a hex or octal number after a complete operand as a positional comment, as in `EPG_au = EPG_ab+1 $1d` or `dc.w 1 $1c`. It used to be taken as more of the expression and reported as an error. `%` still continues the expression, since it is also the modulo operator.

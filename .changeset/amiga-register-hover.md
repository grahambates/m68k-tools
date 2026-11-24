---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Document Amiga custom chip registers and flags on hover when a symbol is named as the Amiga includes name them, in either case: `intena` or `INTENA`, numbered registers such as `COLOR17`, pointer pairs such as `cop1lc`, and flags such as `DMAF_SPRITE` or `INTB_VERTB`. The hover gives the register's address and direction, what it does and its bits, with a link to its page in the Hardware Reference Manual. Nothing is shown where the symbol's value is known and is not the register's offset or address, or the flag's value.

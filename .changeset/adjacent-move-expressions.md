---
"m68k-lint": patch
"m68k-lint-vscode": patch
---

Combining adjacent immediate `move.b`/`move.w` stores keeps named or computed values as a shifted OR, such as `#((C2P_G*4)<<16)|(C2P_G*4)`, rather than packing them into a literal.

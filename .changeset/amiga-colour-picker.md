---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Show a colour swatch, and offer the editor's colour picker, for values written to Amiga colour registers named as the includes name them: `move.w #$0f80,color00(a6)`, `move.w #$0f80,custom+color00` or the copper list pair `dc.w COLOR00,$0f80`. A number literal is rewritten in place, as a 12-bit value in the same base and number of digits, keeping its top four bits and letter case. A constant, `dc.w COLOR00,RED`, shows its colour too, and a constant used as a colour has a swatch where it is defined, `RED equ $f80`, so the picker changes it there; picked at a use, the colour is written to the definition when it is in the same file. Writes made while BPLCON3's LOCT bit is or may be set, which give AGA's low nibbles, are left out.

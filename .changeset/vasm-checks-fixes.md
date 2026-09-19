---
"68kcounter": patch
"m68k-lint": patch
"m68k-parser": patch
---

Fixes found by checking against a real vasm. `trap #n` is two bytes in 68kcounter, not four. `movea.w #$8000,a0` (and other unsigned word values from `$8000` to `$ffff`) is suggested as `lea -32768.w,a0`, since vasm rejects `lea $8000.w`. In `dc.w`, `dc.l` and other sizes wider than a byte, a string is one character constant, so `dc.w "ab"` is one word and `dc.l "abcd"` one long, not one element per character; only `dc.b` counts characters.

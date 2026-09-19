---
"m68k-parser": minor
"m68k-lint": minor
"68kcounter": minor
---

Evaluate expressions as vasm does. Values are now 32-bit signed, so `$ffffffff` is -1 (and less than 5), a product that overflows wraps, and results agree with the assembler where they used to differ, most visibly in comparisons and shifts of large values; a `move.l #$ffffffff,d0` is now seen as fitting `moveq #-1`. Character constants are evaluated (`'A'` is 65, `'AB'` is `$4142`, up to four characters), with backslash escapes read when `escapeSequences` is set. Checked against vasm's output for the operator precedence table and several thousand generated expressions; the remaining differences are chains of unary operators, which vasm rejects, and a chain of comparisons starting with `<=` or `>=`, which vasm evaluates unlike its own documentation.

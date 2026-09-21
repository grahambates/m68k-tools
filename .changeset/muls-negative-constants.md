---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Cover negative constants in `muls-word-full-result-constants` and `muls-word-low-word-only`. `muls.w #-11,d0` and every constant down to -256 now get a shift/add sequence, found by the same search as the positive ones (which already includes negation as an operation), including negative powers of two, which no rule covered: `muls.w #-64,d0` becomes `neg.w d0 ; asl.w #6,d0` when only the low word is used. A word immediate above 32767 is read as the negative it encodes, as vasm does, so `#$fff5` and `#65525` are `#-11`. `muls.w #-1,d0` is still left to `negative-signed-multiply`, and `mulu` is unchanged, because it reads its constant as unsigned. Every new recipe is checked in a test, by the generator, and against Musashi.

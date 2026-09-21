---
"m68k-lint": patch
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

Treat `mulu`, `muls`, `divu` and `divs` written without a size as the word forms they are on the 68000. The multiply and divide rules (`muls-word-*`, `mulu-word-*`, `divu-word-power-of-two`, `multiply-word-by-zero`, `negative-signed-multiply`, and the constant-recipe rules) demanded an explicit `.w`, so `divu #10,d0` was never offered a replacement while `divu.w #10,d0` was. An explicit `.l` is still the long form.

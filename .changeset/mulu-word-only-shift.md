---
"m68k-lint": minor
"m68k-lint-langserver": patch
"m68k-lint-vscode": patch
---

On 68000, `muls-word-power-of-two`, `mulu-word-power-of-two` and their `-high-power-of-two` siblings no longer suggest sign/zero-extending to a long (`swap`/`clr.w`/`swap`/`lsl.l`) when the old upper word of the register is not proven used. `muls-word-low-word-only` and `mulu-word-low-word-only` now offer a plain word shift (`asl.w`/`lsl.w`) there instead — for any power of two, not only the ones in the generated recipe tables — and, like `divu-word-by-constant`, offer it even when that use is merely unproven rather than disproven, as a lower-confidence review noting what could not be checked (the register might, for instance, be this routine's return value past an `RTS`). 68020 and later targets, where the word-only sibling does not apply, are unaffected.

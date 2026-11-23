---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Add `suspicious/address-word-immediate-sign-extension`, which warns when `cmpa.w`, `adda.w` or `suba.w` (or an unsized or generic spelling of them) takes an immediate of `$8000` to `$FFFF`. The immediate is sign-extended, so `cmpa.w #$C000,a0` compares with `$FFFFC000`, and vasm's optimiser reads such a value as written: by default it assembles `suba.w #$8000,a0` as `lea -32768(a0)`, the opposite of the instruction. `move usp,An` is no longer read as MOVEA by rules that match the address-register forms.

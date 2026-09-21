---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Add `optimization/combine-address-adjustments`. Two consecutive constant adjustments of the same address register (`addq`, `subq`, `adda`, `suba`, or `lea d(An),An`) fold into one `addq`, `subq` or `lea`, for example `lea 32(a0),a0` twice becomes `lea 64(a0),a0`, saving 8 cycles. Address registers have no condition codes, so the fold is always safe. It leaves alone pairs that cancel out, which are more likely a mistake, named values, and two `addq.l` that `combine-consecutive-addq` already folds.

---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Generate the constant-multiply recipes instead of maintaining them by hand. `scripts/generate-multiply-recipes.mjs` searches for the cheapest shift/add sequence for every constant from 2 to 256, costing each instruction with 68kcounter, and writes `src/rules/optimization/generated/multiply-recipes.ts`; a test regenerates it so it cannot go stale. `muls-word-full-result-constants` now covers 56 constants (was 26, all of which the search kept or improved), and `muls-word-low-word-only` and `mulu-word-low-word-only` cover every constant from 2 to 256 (were 7 and 12), for example `muls.w #40,d0` becomes a word-only sequence costing 28 cycles instead of 50, and a power of two becomes a single `lsl.w` when the upper word is unobserved. Every recipe was also checked against Musashi. The low-word rules now say only the low word of the scratch register is used, and recipes that need no scratch no longer require one.

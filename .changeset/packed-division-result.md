---
"m68k-lint": minor
"m68k-lint-vscode": patch
---

Warn when a word division's packed quotient/remainder is used in long arithmetic, comparisons or address calculations without extracting the quotient. Intentional packed copies and stores remain accepted; suggestions require manual review.

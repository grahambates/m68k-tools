---
"m68k-lint": patch
---

Count names that a macro call builds when deciding whether a label or constant is used. `CALLINIT Sound` over a macro containing `jsr Init_\1` refers to `Init_Sound`, but only the call was scanned, so `suspicious/unused-global-label` and `suspicious/unused-constant` reported a routine or constant that was in fact used. Each call to a macro the project defines is now expanded when the reference index is built, and the names in the result count as references. This can only add references, so it can only remove false reports.

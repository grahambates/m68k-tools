---
"68kcounter": minor
"68kcounter-vscode": minor
---

Add initial cached integer reference costs for the 68040 and 68060, selected through CPU options, source directives and extension defaults. Preserve 68040 execution lead/base and address-calculation data, and expose 68060 branch-prediction alternatives. Label operand accesses separately from external bus transfers, keep different timing models separate in displayed totals, and flag missing timing coverage. These reference sums do not model sequence overlap or 68060 pairing; no uncached model is provided for these CPUs.

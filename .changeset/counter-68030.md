---
"m68k-parser": patch
"68kcounter": minor
"68kcounter-vscode": minor
---

Add 68030 instruction-cache and average no-cache timing estimates from Motorola's manual, preserving reads/prefetches/writes. Support CPU selection through library options, CLI, machine directives and extension defaults. Share cached-CPU lookup construction with 68020 while retaining separate timing data. Resolve full-format and pre/post-indexed memory-indirect timing costs from displacement sizes, including MOVE destinations. Preserve PC bases in parsed memory-indirect operands. Leave unresolved encodings untimed and document estimation assumptions. Label the extension's non-cached mode Uncached; the existing worst configuration value remains compatible.

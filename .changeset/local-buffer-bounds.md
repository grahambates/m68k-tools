---
"m68k-lint": minor
"m68k-lint-vscode": patch
---

Add suspicious/buffer-overrun for simple postincrement loops over contiguous data in any section. Detect excessive DBRA counts and inclusive end-pointer bounds that cross into instructions or beyond a known section end. Support DC/DS/DCB tables, internal labels, offset aliases and section reopenings without requiring known table contents or simulating loop iterations. Unknown output and incomplete source extents remain conservative; suggestions require manual review.

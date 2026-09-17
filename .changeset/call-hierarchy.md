---
"m68k-lsp-server": minor
---

Add call hierarchy support: "Show Call Hierarchy" now lists incoming callers and outgoing calls for a routine, based on `bsr`/`jsr` instructions whose target is a resolvable label. Calls made through a register or other computed address are not shown, since their target cannot be determined statically.

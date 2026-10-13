---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Hovering a routine's label, at its definition or in a `bsr`/`jsr`, summarises the registers it reads and modifies as its callers see them, following the subroutines it calls, for example `Reads D0/A0 · Modifies D0–D1/A0`. Changes a stack restore undoes are not counted as modifications.

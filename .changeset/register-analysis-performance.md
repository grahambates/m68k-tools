---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Register availability and routine register summaries no longer hang the server on large programs whose routines call each other recursively. Subroutine summaries are now worked out together to a fixed point, rather than recomputed for every recursive path, and the work spent following subroutines is limited. Past the limit, a subroutine not yet summarised is taken at its header's word, or makes the answer unknown, rather than holding up the server. Register usage now looks only at the lines in its range, and stack-save lookups no longer scan the whole file.

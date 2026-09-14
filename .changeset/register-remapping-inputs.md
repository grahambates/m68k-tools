---
"m68k-lsp-server": patch
---

Warn when remapping a register whose value is read before it is written in the selected scope, so callers or initialisation outside the scope can be updated. Keep the proposed edits available to apply.

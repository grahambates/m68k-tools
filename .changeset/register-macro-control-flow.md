---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Register liveness accounts for control flow inside macro expansions. A macro with labels, branches or returns of its own no longer counts its writes as definite overwrites. Its branches to the caller's labels and its returns are followed from the call, and a subroutine called inside a macro makes availability unknown instead of being ignored.

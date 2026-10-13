---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

The register analysis scope is now called a block: the code from a non-local label to where its control flow ends. Messages in the remapping panel and register commands say "block" instead of "routine". The private protocol's `m68k/routineRange` request is now `m68k/blockRange`.

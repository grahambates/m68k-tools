---
"m68k-lsp-server": patch
"m68k-lsp": patch
---

Resolve includes again once workspace indexing finishes, so that an include found relative to its main source connects even when the including file was indexed first. Definitions, references and hover in such files no longer depend on the file being open.

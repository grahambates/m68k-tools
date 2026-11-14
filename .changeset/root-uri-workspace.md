---
"m68k-lsp-server": patch
---

Clients that send only a root URI or root path, and no workspace folders, now get a workspace. Previously the server had none with such a client, so `.m68krc.json` was never read and the project was not indexed. The log now also names the vasm binary it could not find.

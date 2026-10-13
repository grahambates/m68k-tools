---
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Register analysis resolves `equr`, `equrl` and `reg` aliases, including ones defined in included files, so uses such as `move.w count,d1` or `(ptr)+` count towards the aliased register's usage and availability. Register usage results report them with the reference kind `alias`, and remapping or swapping a register used through an alias is refused as an unsupported reference. Alias definition lines no longer count as uses of their registers. Hovering an alias shows the register's description.

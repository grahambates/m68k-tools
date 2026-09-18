---
"m68k-lint": patch
"m68k-lint-vscode": patch
---

`m68k-lint --init` now writes a `$schema` URL pinned to the CLI's version instead of a path into `node_modules`, which rarely exists in an assembly project. The schema `$id` no longer points at the archived standalone repository. The VS Code extension now bundles the schema and validates `m68k-lint.json` and `.m68klintrc.json` against it offline, rather than fetching it from that repository.

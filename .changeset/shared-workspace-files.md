---
"m68k-lsp-server": patch
"m68k-lint-langserver": patch
---

Share workspace file discovery (recursive walk, exclude-pattern matching) between the assembly and linter language servers via a new private `@m68k-lsp/workspace-files` package, instead of each maintaining its own implementation.

No intended behaviour change for `m68k-lsp-server`. For `m68k-lint-langserver`, project indexing now respects real glob exclude patterns (previously a fixed set of skipped directory names with no way to configure it) via the same mechanism the assembly server already exposed through its own `exclude` setting; a hidden directory other than `.git` is no longer skipped unconditionally, since it is now covered by the same exclude-pattern default both servers share instead of a blanket dotfile rule.

---
"m68k-lint": minor
---

Files the project ignores are now left out of linting but still read. `ignores` (and `--ignore-pattern`) used to drop a file from the project index as well, so ignoring a system include the project only borrows from, to stop every symbol it does not use being reported, also stopped the constants and macros in it resolving and silenced the rules that depend on them. Now an ignored file is never reported on but its constants, macros and references still count, which is what the README already said headers are for and what the language server already did. Only `node_modules/**` and `.git/**` are skipped entirely. The help text, init prompt, schema and README say so.

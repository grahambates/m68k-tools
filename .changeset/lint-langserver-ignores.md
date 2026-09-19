---
"m68k-lint-langserver": minor
---

Apply the project config's `ignores`. A file it lists is not linted in the editor either: it gets no findings and no code actions, so opening a system include no longer shows every unused symbol in it. Patterns are relative to the config file, as on the command line. The file is still indexed for the constants and macros it provides.

Add an **Ignore this file** quick fix on any finding. It adds the file to `ignores` in the config that applies, beside the existing entries and leaving the rest of the file as it was, and creates `m68k-lint.json` at the workspace root when there is none, for clients that can create a file as part of an edit. It is never offered for a file outside every workspace folder, such as a shared include, since a config would have to be written into a directory the project does not own.

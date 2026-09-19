---
"m68k-lint": minor
---

Add `portability/include-case`, flagging an `INCLUDE` or `INCBIN` path whose case differs from the file on disk. On a case-insensitive file system (macOS, Windows) the assembler accepts `include "Exec/Types.i"` for `exec/types.i` and the author never hears of it, but the project does not build on a case-sensitive one such as Linux or a build server. The path as it is on disk is offered as a safe fix. Rules read only text, so the command line and the language server work out what each include is called on disk beforehand and hand it over as a new `FileFacts` argument to `lintSource` and `lintParsedFile`; the rule stays silent where none was given, as for text from standard input. Adds the `portability` category's first rule, `includeCaseOnDisk` and `needsIncludeCase`, and lets a fix rewrite a directive line as the same directive.

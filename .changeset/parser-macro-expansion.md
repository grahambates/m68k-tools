---
"m68k-parser": minor
---

Add macro expansion. `collectMacroDefinitions` finds the macro definitions in a file, named either by label (`Name: macro`) or by operand (`macro Name`). `expandMacro` expands a call by substituting its arguments into the body as text and parsing each resulting line, following calls to other macros with depth and recursion limits. `substituteMacroParameters` and `macroInvocation` are the building blocks. A parameter the call did not supply is empty, as in an assembler. Handles `\0`-`\9`, `\a`-`\z`, `\?n`, `\#`, `\.`, `\+`, `\-`, `\@`, `NARG` and `CARG`, and traces each substituted span back to the argument it came from through nested calls. The caller supplies the lookup for definitions, so it works for one file, a file and its includes, or a whole project.

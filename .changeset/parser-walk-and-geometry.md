---
"m68k-parser": minor
---

Export the structural syntax-tree walker (`walkLine`, `walkFile`, `childNodes`, `lineNodes`, `descendants`, `isAstNode`, `AstNode`) and range helpers (`locationAsRange`, `containsPosition`, `containsRange`, `isBeforeOrEqual`, with `TextPosition` and `TextRange`), which the formatter and the assembly language server each carried an identical copy of. The range types are structurally the same as the language server protocol's, so either is accepted, and the parser takes no dependency on a language server library.

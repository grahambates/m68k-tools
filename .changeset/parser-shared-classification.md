---
"m68k-parser": minor
---

Add shared classification helpers that the formatter, language server, linter and 68kcounter each kept their own copy of. `isLocalLabelName` and `bareLocalName` say what spelling makes a label local, and `analyzeLocalLabelScopes` ties each local label to the global label whose routine it is in (a label that only defines a symbol, or sits in a macro body or conditional block, does not start a routine). `addressingMode` names the addressing mode of an operand. `canonicalConditionMnemonic` reads `HS`, `LO` and `DBRA` as `CC`, `CS` and `DBF`, and `addressRegisterForm` gives `MOVEA`, `ADDA`, `SUBA` and `CMPA` for the generic spellings. `sectionTypeNames`, `isSectionDirective` and `isBlockDirective` describe sections and blocks.

---
"68kcounter": patch
---

Count `dc`, `dcb` and `ds` written without a size as words, as an assembler does. They were counted as nothing, so `dc 1,2,3` reported 0 bytes instead of 6. Directive sizes now come from the parser, shared with the linter.

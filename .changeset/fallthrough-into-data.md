---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Added `suspicious/fallthrough-into-data`, a warning for code that can run straight on into DC, DS, DCB or INCBIN data in the same section, which would then be executed as instructions. Falling into word or long data is reported with low confidence, since that is how hand-assembled or self-modifying instructions are written, with a note on disabling the rule for the line when it is deliberate. A subroutine call followed by data is not reported, as that is the inline-argument idiom (`bsr Print` then `dc.b "text",0`).

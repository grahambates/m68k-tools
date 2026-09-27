---
"m68k-lint": minor
"m68k-lint-langserver": minor
"m68k-lint-vscode": minor
---

Added `correctness/amiga-cross-section-pc-relative`, an error on the Amiga platform for a PC-relative reference such as `lea table(pc),a0`, or a branch, to a label this file defines in another section. Each section is a separate hunk, so vasm rejects the reference when writing an executable, and vlink when linking. The fix drops the `(pc)` and uses the absolute address. It is safe from code to data or BSS, and conditional between two code sections, or among data and BSS, which small code (`-sc`) or small data (`-sd`) linking would merge. BSR and BRA are fixed as JSR and JMP. Indexed forms such as `tab(pc,d0.w)`, Bcc and DBcc have no absolute equivalent, so they are reported with a suggested rewrite but no automatic fix. Sections are matched as vasm matches them, by name, type and memory attribute. The rule stays silent wherever the section cannot be worked out from the file: after an INCLUDE, ORG or OFFSET, after a macro that may switch sections, or after a conditional block whose arms end in different sections.

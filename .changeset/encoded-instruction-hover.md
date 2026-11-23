---
"m68k-parser": minor
"m68k-lsp-server": minor
"m68k-lsp": minor
---

Show hover documentation for the instruction a line is encoded as, chosen by its operands: `cmp.w d0,a0` documents CMPA, `add.w #1,(a0)` ADDI and `cmp (a0)+,(a1)+` CMPM, and condition-code synonyms such as `dbra` now find their documentation. Forms with a reference page of their own are documented on their own, so `move.w d0,ccr` shows MOVE to CCR, with its condition codes and addressing modes, rather than every MOVE form; likewise MOVE from CCR, to and from SR, MOVE USP, and ANDI, ORI and EORI to CCR and SR. The general EORI documentation no longer shows the EORI to SR description and condition codes, and ORI to CCR is documented as a byte operation, as vasm requires. `m68k-parser` adds `encodedInstruction(name, modes)` for this selection.

---
"m68k-lint": patch
---

Model more instructions when following registers. `Scc`, `PEA`, `CHK`, `NBCD`, `ADDX`, `SUBX`, `ABCD`, `SBCD`, `CMPM` and `MOVEP` used to be treated as having unknown effects, which made every rule that follows registers stand down around them; they now say what they read and write. A shift or rotate written with one operand, such as `lsr.w d0`, was recorded as reading the register without changing it, so a constant held there was still believed after the shift; it now counts as a write. Found by checking the linter's register model against the language server's over the instruction corpus, where they now agree on all but a design difference over the implicit stack pointer.

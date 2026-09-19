---
"m68k-lint": minor
---

Evaluate conditional assembly that the file itself can settle. `IF`, `IFEQ`, `IFNE`, `IFGT`, `IFGE`, `IFLT`, `IFLE` and `ELSEIF` are decided from literals and constants the file (or the project index) resolves, and `IFD`, `IFND`, `IFMACROD` and `IFMACROND` from names the file defines earlier. Only the arm an assembler would take is treated as code: the others no longer take part in control flow, register values or the file's constants, so a constant defined one way in an `IF` arm and another in its `ELSE` arm is no longer a conflict, and a write in an arm that is not assembled is no longer reported as dead. Blocks whose condition cannot be settled (a name defined elsewhere or on the assembler's command line, string comparisons) are treated exactly as before. Conditionals inside a macro body are settled once the call's arguments are substituted, so `if narg>1` and `ifb \2` pick their arm and such macros are now seen through like any other.

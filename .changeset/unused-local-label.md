---
"m68k-lint": minor
---

Add `suspicious/unused-local-label`, flagging a local label (`.loop`, `loop$`) that nothing in its routine refers to. Restricted to local labels, since their scope guarantees nothing outside the enclosing global label can reference them; a global label with no in-file reference is left alone, as it may still be reached from another module or a jump table. Matching follows the same scoping an assembler uses -- the nearest preceding global label -- so two routines may each have their own unused `.loop` without one hiding the other.

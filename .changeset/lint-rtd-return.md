---
"m68k-lint": patch
---

Treat `RTD` as a return in flow analysis. It was treated as falling through to the next instruction, so code after it looked reachable and register and flag state was carried across it. Return handling is now decided in one place rather than by separate lists of return mnemonics in several rules.

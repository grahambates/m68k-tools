---
"m68k-lint": minor
---

Optimisation and analysis rules now see character constants as the numbers they are, where they used to skip any immediate written as a string. `move.l #'A',d0` is now suggested as `moveq #'A',d0`, and register values and flags tracked through such an immediate are known. A replacement keeps the constant as written, including a blank inside the quotes (`#' '`), which is a character and is no longer squeezed out with the spacing.

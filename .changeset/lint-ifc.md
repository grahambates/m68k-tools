---
"m68k-lint": minor
---

Settle `IFC` and `IFNC` string comparisons. Both strings are read from the line's text, quoted or bare (a blank argument is an empty string), and compared exactly, so `ifc \1,\2` and the usual missing-argument test `ifnc "\1",""` in a macro body pick their arm once the arguments are substituted. A line the comparison cannot be read from with confidence, such as unquoted text with spaces in it or an argument not yet substituted, is left undecided as before.

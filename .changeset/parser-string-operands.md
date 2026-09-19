---
"m68k-parser": patch
---

Parse a quoted string that is followed by operators as the expression it is. `#'A'+1`, `ds.b 'A'+1` and `if 'A'=65` used to become a single string whose text ran on to the end of the operand (`A'+1`), losing the operator and any value. A string closed before the end of the operand now starts an expression; one that fills the operand is a string as before. A doubled quote inside a string (`"a""b"`, `'it''s'`) is now one quote character, as vasm reads it, so `dc.b "a""b"` is three bytes, not four.

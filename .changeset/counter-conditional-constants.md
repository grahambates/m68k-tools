---
"68kcounter": patch
---

A constant assigned in a conditional block no longer takes the value of the last arm. The counter still shows every arm, but a constant that ends a block with different values depending on the arm, or that a block with no `ELSE` may not have set, is unknown afterwards, so what is sized by it is unknown too and not a guess. A constant every arm agrees on keeps its value, each arm starts from what was known before the block, and blocks nest. Labels are unaffected. `IF` and `ELSEIF` are recognised as directives.

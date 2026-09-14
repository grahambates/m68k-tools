---
"m68k-parser": minor
"m68k-lint": minor
"68kcounter": major
---

Expose expression parsing and constant evaluation from m68k-parser, and share the evaluator between the linter and counter. Counter expressions now follow vasm operator precedence and integer division instead of JavaScript expression semantics. Preserve zero-valued assignments, reject malformed expressions, and remove the counter's direct expression-eval dependency.

Match vasm Motorola-syntax boolean results (-1 for true comparisons and logical binary operations, 1 for unary logical negation).

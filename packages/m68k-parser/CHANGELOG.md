# m68k-parser

## 2.0.0

### Major Changes

- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.

### Minor Changes

- 0ea9bcc: Preserve explicit word/long base and outer displacement widths in the operand AST, and use them when calculating instruction sizes and 68030/68040/68060 timing references.
- b86ae11: Expose expression parsing and constant evaluation from m68k-parser, and share the evaluator between the linter and counter. Counter expressions now follow vasm operator precedence and integer division instead of JavaScript expression semantics. Preserve zero-valued assignments, reject malformed expressions, and remove the counter's direct expression-eval dependency.

  Match vasm Motorola-syntax boolean results (-1 for true comparisons and logical binary operations, 1 for unary logical negation).

### Patch Changes

- ade45b3: Add 68030 instruction-cache and average no-cache timing estimates from Motorola's manual, preserving reads/prefetches/writes. Support CPU selection through library options, CLI, machine directives and extension defaults. Share cached-CPU lookup construction with 68020 while retaining separate timing data. Resolve full-format and pre/post-indexed memory-indirect timing costs from displacement sizes, including MOVE destinations. Preserve PC bases in parsed memory-indirect operands. Leave unresolved encodings untimed and document estimation assumptions. Label the extension's non-cached mode Uncached; the existing worst configuration value remains compatible.
- 555bafb: - `m68k-parser` now recognises the `db`, `dl`, `fopt` and `radix` directives, which were documented but missing from the directive list.
  - The assembly syntax grammar (`m68k-lsp`) now highlights floating-point literals, the full set of special/control and FPU registers, all built-in symbols (`__CPU`, `__VASM`, etc.), and no-operand directives used for trailing-comment detection (`endm`, `endif`, `else`, etc.). It also fixes the line-comment `*` rule to no longer swallow parenthesised, bracketed or braced expressions containing multiplication, and corrects macro-parameter escape highlighting to recognise single-letter parameters (`\a`).

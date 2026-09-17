# 68kcounter

## 5.0.0

### Major Changes

- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.
- b86ae11: Expose expression parsing and constant evaluation from m68k-parser, and share the evaluator between the linter and counter. Counter expressions now follow vasm operator precedence and integer division instead of JavaScript expression semantics. Preserve zero-valued assignments, reject malformed expressions, and remove the counter's direct expression-eval dependency.

  Match vasm Motorola-syntax boolean results (-1 for true comparisons and logical binary operations, 1 for unary logical negation).

### Minor Changes

- ade45b3: Add 68030 instruction-cache and average no-cache timing estimates from Motorola's manual, preserving reads/prefetches/writes. Support CPU selection through library options, CLI, machine directives and extension defaults. Share cached-CPU lookup construction with 68020 while retaining separate timing data. Resolve full-format and pre/post-indexed memory-indirect timing costs from displacement sizes, including MOVE destinations. Preserve PC bases in parsed memory-indirect operands. Leave unresolved encodings untimed and document estimation assumptions. Label the extension's non-cached mode Uncached; the existing worst configuration value remains compatible.
- 4c6cdec: Add initial cached integer reference costs for the 68040 and 68060, selected through CPU options, source directives and extension defaults. Preserve 68040 execution lead/base and address-calculation data, and expose 68060 branch-prediction alternatives. Label operand accesses separately from external bus transfers, keep different timing models separate in displayed totals, and flag missing timing coverage. These reference sums do not model sequence overlap or 68060 pairing; no uncached model is provided for these CPUs.
- 79d0e32: Add native ESM entry points and matching TypeScript declarations alongside the existing CommonJS builds. Preserve CommonJS entry points, CLI paths and deep file imports.

### Patch Changes

- 00b35e5: Correct byte-size estimates for MOVEM effective addresses, long branches and LINK, long multiply/divide, and resolved full-format and memory-indirect displacements. Add 68040 cached timing references for memory shifts and rotates, ordinary bit operations, and word MOVEM loads.
- 9527976: Convert hexadecimal, binary and octal literals without JavaScript eval, removing direct-eval build warnings.
- 0ea9bcc: Preserve explicit word/long base and outer displacement widths in the operand AST, and use them when calculating instruction sizes and 68030/68040/68060 timing references.
- 0ea9bcc: Expose additive base and effective-address calculation costs for 68020/68030 and 68060 timing results, including the base costs for the selected cache model. Timing totals are unchanged.
- Updated dependencies [ade45b3]
- Updated dependencies [0ea9bcc]
- Updated dependencies [555bafb]
- Updated dependencies [f77f9fc]
- Updated dependencies [b86ae11]
  - m68k-parser@2.0.0

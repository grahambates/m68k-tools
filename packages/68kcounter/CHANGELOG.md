# 68kcounter

## 5.1.0

### Minor Changes

- a8034b3: Know about vasm's `-esc`. `escapeSequences` joins `.m68krc.json` (and `m68k-lint.json`, and `m68k.escapeSequences` in editor settings); an `-esc` among the vasm arguments is read as the option, and the assembly server passes `-esc` to vasm when it is set. With it, a backslash in a string is read as vasm does: `\n \r \t \b \e \f`, `\\ \" \'`, up to three octal digits (`\101`) and `\x` with up to two hex digits are one element each, so string data is shorter than it is written. `m68k-parser` gains `decodeStringEscapes`, and `directiveSize` takes `escapeSequences`; the linter's alignment analysis and 68kcounter's `parse` use it. Sequences checked against vasm's own output; `\a` and `\v` are not supported by it.
- 84eb9ee: Evaluate expressions as vasm does. Values are now 32-bit signed, so `$ffffffff` is -1 (and less than 5), a product that overflows wraps, and results agree with the assembler where they used to differ, most visibly in comparisons and shifts of large values; a `move.l #$ffffffff,d0` is now seen as fitting `moveq #-1`. Character constants are evaluated (`'A'` is 65, `'AB'` is `$4142`, up to four characters), with backslash escapes read when `escapeSequences` is set. Checked against vasm's output for the operator precedence table and several thousand generated expressions; the remaining differences are chains of unary operators, which vasm rejects, and a chain of comparisons starting with `<=` or `>=`, which vasm evaluates unlike its own documentation.
- 3d61532: Keep symbol case by default, as vasm does. `Foo` and `foo` are different symbols unless the assembler was given `-nocase`; the linter used to treat every name as case-insensitive, so two symbols differing only in case merged into one, giving a false conflict for constants, hiding unused labels, and letting a branch to `.Loop` land on `.loop`. Constants, labels, local labels and macros now keep their case throughout, and instruction, directive and register names are still matched without regard to case.

  A project assembled with `-nocase` says so: `caseSensitive: false` in `m68k-lint.json`, or in the assembly server's config, which also follows a `-nocase` among the vasm arguments when the setting is unset. 68kcounter's `parse` takes `{ caseSensitive: false }`. The assembly server re-reads every document when the setting changes. `m68k-parser` gains `symbolKey`, and `analyzeLocalLabelScopes` takes the option. Macro names in 68kcounter and the assembly server, which used to ignore case, now keep it like other symbols. `opt c-` in the source is not read yet.

### Patch Changes

- 2483db0: A constant assigned in a conditional block no longer takes the value of the last arm. The counter still shows every arm, but a constant that ends a block with different values depending on the arm, or that a block with no `ELSE` may not have set, is unknown afterwards, so what is sized by it is unknown too and not a guess. A constant every arm agrees on keeps its value, each arm starts from what was known before the block, and blocks nest. Labels are unaffected. `IF` and `ELSEIF` are recognised as directives.
- 530995e: Count `dc`, `dcb` and `ds` written without a size as words, as an assembler does. They were counted as nothing, so `dc 1,2,3` reported 0 bytes instead of 6. Directive sizes now come from the parser, shared with the linter.
- ca3b18b: Substitute macro parameters with the routine shared with the other tools, so macro calls are counted the way an assembler expands them. `\0` (the size the macro was called with), `NARG`, `\#`, `\?n` and the `\.`, `\+`, `\-` selectors now work; a numbered argument the call did not supply is empty rather than left in the text; and `\10` is `\1` followed by a zero, as in vasm, where arguments beyond nine are `\a` to `\z` and only in Devpac mode. Definitions are still tracked as the file is read, so timings and byte counts for each expanded line are unchanged.
- 2483db0: `iif` now keeps the statement it makes conditional. `ParsedLine.inlineStatement` is that statement parsed as a line of its own, with locations in the `iif` line, so `iif DEBUG move.w d0,d1` has its `move`, its `.w` and its operands, where only the operands and the condition were kept before. The condition still ends at the first blank, as in vasm. 68kcounter counts the statement, with its size and timing, as it would on a line of its own. `expandInlineStatements` turns each `iif` line in a parsed file into the statement it makes conditional, keeping the label, comment and condition, for tools that read a line's mnemonic and operands.
- 2daedf1: Fixes found by checking against a real vasm. `trap #n` is two bytes in 68kcounter, not four. `movea.w #$8000,a0` (and other unsigned word values from `$8000` to `$ffff`) is suggested as `lea -32768.w,a0`, since vasm rejects `lea $8000.w`. In `dc.w`, `dc.l` and other sizes wider than a byte, a string is one character constant, so `dc.w "ab"` is one word and `dc.l "abcd"` one long, not one element per character; only `dc.b` counts characters.
- Updated dependencies [a8034b3]
- Updated dependencies [84eb9ee]
- Updated dependencies [2483db0]
- Updated dependencies [530995e]
- Updated dependencies [ca3b18b]
- Updated dependencies [530995e]
- Updated dependencies [2daedf1]
- Updated dependencies [530995e]
- Updated dependencies [3d61532]
- Updated dependencies [2daedf1]
  - m68k-parser@2.1.0

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

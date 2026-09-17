# m68k-lint

## 2.0.0

### Major Changes

- f77f9fc: Require Node.js 22.15.1 or later for Node packages and VS Code 1.101 or later for
  extensions. Builds and releases now come from the shared m68k-tools workspace.
  Existing npm and Marketplace identities are preserved.
- 02a4260: Annotate intent-obscuring rule fixes by default using explicit rule metadata. Replace boolean fix annotation options with obfuscated, all, and none modes across the library, CLI, interactive review, and editor. Add project fixAnnotate configuration.

  Migration: replace bare `--fix-annotate` with `--fix-annotate obfuscated`. Replace boolean library and editor annotation settings with `obfuscated` (previous `true`) or `none` (previous `false`); use `all` to annotate every applied fix. Omitting the setting now defaults to rule-specific annotation.

  Classify existing rules for lost constants/expressions and opaque tricks, and expose the classification in the rule documentation. Routine idioms and multiple lines alone do not qualify.

### Minor Changes

- 953e621: Offer conditional and manual-review replacements as explicitly labelled editor actions while keeping Fix All conservative by default. Make actions accessible throughout a multiline finding. Highlight the affected instruction and operands or instruction sequence when an optimization previously pointed only at its mnemonic.
- 87d5a19: Collapse duplicate safe optimization replacements and omit provably inferior alternatives on 68000. Group remaining safe alternatives for the same instruction sequence, preserving individual rule details and tradeoffs. CLI review supports numbered choices and VS Code offers separate code actions; automatic fixes leave grouped alternatives for the user to choose.
- b86ae11: Expose expression parsing and constant evaluation from m68k-parser, and share the evaluator between the linter and counter. Counter expressions now follow vasm operator precedence and integer division instead of JavaScript expression semantics. Preserve zero-valued assignments, reject malformed expressions, and remove the counter's direct expression-eval dependency.

  Match vasm Motorola-syntax boolean results (-1 for true comparisons and logical binary operations, 1 for unary logical negation).

- f5b17bb: Re-verified every CPU-gated optimization rule against 68kcounter, which now
  models 68020 through 68060 (it did not when most of these gates were
  written, and several trace back to ASP68K's own reference table, which
  marks 68020 "?" -- never measured -- for nearly every row).

  35 rules were needlessly withheld on CPUs where they are in fact a clean,
  non-regressing improvement, most commonly 68020: `address-add-to-lea`,
  `address-arithmetic-indexed-lea`, `address-sub-to-lea`, `bset-to-tas`,
  `cmp-zero-address-via-scratch`, `cmpa-zero-to-tst-030` (now correctly
  68020+ rather than 68030-only -- TST An has no 68kcounter timing entry
  before 68020, confirming ASP68K's "-" marker there too),
  `combine-loads-into-movem` (also gained 68060), `fold-index-into-effective-
address`, `known-register-asr-saturate`, `known-register-rotate`,
  `known-zero-clear`, `lea-zero-address`, `move-byte-and-mask`,
  `move-immediate-swap`, `move-immediate-via-scratch`,
  `move-immediate-word-complement`, `muls-long-060-simple` (now 68020+
  rather than 68060-only), `muls-word-by-one`, `muls-word-power-of-two`,
  `muls-word-selected-constants`, `multiply-long-by-one` (now 68020+ rather
  than 68060-only -- MULS.L/MULU.L only exist from 68020), `multiply-long-
large-power-of-two`, `multiply-long-small-constant`, `multiply-word-by-
zero`, `narrow-address-immediate-word`, `narrow-movea-immediate-word`,
  `normalize-byte-rotate-direction`, `prefer-add-for-shift-one`,
  `prefer-bclr`, `prefer-bset`, `push-immediate-pea`, `roxl-to-addx`,
  `simplify-long-word-mask`, `single-register-movem`, `zero-arithmetic-to-
tst`.

  Two rules were found actively wrong -- claiming a win on a CPU where
  68kcounter shows a real regression -- and are now narrower:

  - `shift-two-adds`: LSL.B/W #2 -> two ADDs ties on cycles on 68030 (4 vs 4)
    while costing 2 more bytes, so 68030 no longer fires for LSL (ASL is
    unaffected: it is a genuine win there).
  - `combine-loads-into-movem`: folding 3+ postincrement loads into one MOVEM
    is 6 to 10 cycles _slower_ than the loads it replaces on 68030, at every
    register count from 2 through 8 -- not the win the rule previously
    assumed carried over from 68000/68020. 68030 no longer fires; 68060 was
    added instead (a genuine, if cycle-neutral, byte win there).

  `movea-immediate-to-lea` keeps firing unconditionally -- its value is
  clarity and PC-relative relaxation, not raw cycles, and that was already
  true on 68000 -- but its docs now note the one CPU (68020) where the
  absolute-long form it targets is actually a cycle slower.

### Patch Changes

- 18104ae: Treat subroutine calls and other unknown register effects as barriers in bit-level register analysis. Avoid reporting narrow register writes as overwritten before use when an intervening call may consume their values.
- 3406c3c: Highlight a single changed operand or mnemonic when an optimization replacement identifies it precisely. Keep whole-instruction highlights for broader rewrites and removals, separate from the full-line edit spans.
- a6de977: Added a worked before/after example for every optimization rule, in a new
  `docs/rule-examples.md` linked from each rule's id in `docs/rules.md`. Each
  example shows only the lines a finding actually covers, plus its impact and
  notes, and is generated from the rule's own lint/fix pipeline so it stays
  accurate as rules change.
- Updated dependencies [ade45b3]
- Updated dependencies [4c6cdec]
- Updated dependencies [00b35e5]
- Updated dependencies [9527976]
- Updated dependencies [79d0e32]
- Updated dependencies [0ea9bcc]
- Updated dependencies [555bafb]
- Updated dependencies [f77f9fc]
- Updated dependencies [b86ae11]
- Updated dependencies [0ea9bcc]
  - m68k-parser@2.0.0
  - 68kcounter@5.0.0

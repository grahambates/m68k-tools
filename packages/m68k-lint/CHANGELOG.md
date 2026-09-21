# m68k-lint

## 2.2.0

### Minor Changes

- cb84cd3: Add `suspicious/odd-address-access` (error) and `suspicious/missing-even`. The first flags a word or long access at an address that is provably odd: a numeric or `equ` address, an address register holding a known value, or a label on byte data whose position follows from the data before it. The second flags an instruction, or word-sized data on a 68000/68010, placed after an odd number of bytes such as `dc.b "abc"`. Both stay silent once the position cannot be worked out (after INCLUDE, INCBIN, a macro or a conditional block) and are restarted by `even`, `cnop`, `align` and new sections. Later processors permit unaligned data access, so those checks apply only when a 68000, 68010 or CPU32 is a target.
- ca3b18b: Evaluate conditional assembly that the file itself can settle. `IF`, `IFEQ`, `IFNE`, `IFGT`, `IFGE`, `IFLT`, `IFLE` and `ELSEIF` are decided from literals and constants the file (or the project index) resolves, and `IFD`, `IFND`, `IFMACROD` and `IFMACROND` from names the file defines earlier. Only the arm an assembler would take is treated as code: the others no longer take part in control flow, register values or the file's constants, so a constant defined one way in an `IF` arm and another in its `ELSE` arm is no longer a conflict, and a write in an arm that is not assembled is no longer reported as dead. Blocks whose condition cannot be settled (a name defined elsewhere or on the assembler's command line, string comparisons) are treated exactly as before. Conditionals inside a macro body are settled once the call's arguments are substituted, so `if narg>1` and `ifb \2` pick their arm and such macros are now seen through like any other.
- f32f4d5: Add `suspicious/constant-condition`, flagging a conditional branch or `Scc` whose outcome is known in advance. Works out the condition codes left by `MOVEQ`, `MOVE`, `CLR`, `TST`, `CMP`, `CMPI` and `CMPA` from operands the register analysis knows, honouring the operation size and the signed and unsigned conditions, and reports only when every path to the branch sets them the same way. An always-taken branch is usually a comparison against the wrong register or a stale value, and a never-taken one is dead code.
- a8034b3: Know about vasm's `-esc`. `escapeSequences` joins `.m68krc.json` (and `m68k-lint.json`, and `m68k.escapeSequences` in editor settings); an `-esc` among the vasm arguments is read as the option, and the assembly server passes `-esc` to vasm when it is set. With it, a backslash in a string is read as vasm does: `\n \r \t \b \e \f`, `\\ \" \'`, up to three octal digits (`\101`) and `\x` with up to two hex digits are one element each, so string data is shorter than it is written. `m68k-parser` gains `decodeStringEscapes`, and `directiveSize` takes `escapeSequences`; the linter's alignment analysis and 68kcounter's `parse` use it. Sequences checked against vasm's own output; `\a` and `\v` are not supported by it.
- 84eb9ee: Evaluate expressions as vasm does. Values are now 32-bit signed, so `$ffffffff` is -1 (and less than 5), a product that overflows wraps, and results agree with the assembler where they used to differ, most visibly in comparisons and shifts of large values; a `move.l #$ffffffff,d0` is now seen as fitting `moveq #-1`. Character constants are evaluated (`'A'` is 65, `'AB'` is `$4142`, up to four characters), with backslash escapes read when `escapeSequences` is set. Checked against vasm's output for the operator precedence table and several thousand generated expressions; the remaining differences are chains of unary operators, which vasm rejects, and a chain of comparisons starting with `<=` or `>=`, which vasm evaluates unlike its own documentation.
- 581f5d4: Files the project ignores are now left out of linting but still read. `ignores` (and `--ignore-pattern`) used to drop a file from the project index as well, so ignoring a system include the project only borrows from, to stop every symbol it does not use being reported, also stopped the constants and macros in it resolving and silenced the rules that depend on them. Now an ignored file is never reported on but its constants, macros and references still count, which is what the README already said headers are for and what the language server already did. Only `node_modules/**` and `.git/**` are skipped entirely. The help text, init prompt, schema and README say so.
- 11ee555: Search for includes as vasm does. vasm looks in the directory it is run in, then in the directory of the main source, then the `-I` paths and `incdir`s, and never beside the file that names the include; the linter and the assembly server looked beside the including file and in the include paths only. They now also look in the directory of the main source (the file nothing else includes) and follow `incdir` directives, so an include named from the main source's directory by a file in another directory, or one reached through `incdir`, is found and its constants and macros are read. vasm's own order is tried first, so the file read is the one vasm opens, and looking beside the including file is kept only as a last resort, so nothing that was found before is lost. The search is one function shared by the linter, the linter server and the assembly server. Checked against vasm 1.9.
- 84eb9ee: Optimisation and analysis rules now see character constants as the numbers they are, where they used to skip any immediate written as a string. `move.l #'A',d0` is now suggested as `moveq #'A',d0`, and register values and flags tracked through such an immediate are known. A replacement keeps the constant as written, including a blank inside the quotes (`#' '`), which is a character and is no longer squeezed out with the spacing.
- 581f5d4: Export what an editor needs to work with a project's ignore list from `m68k-lint/project-config`: `isIgnored` and `alwaysIgnored` decide whether a path is left out of linting, `configIgnores` reads the list under either of its names, and `addIgnoreToConfigText` and `newConfigText` add a file to a config's `ignores`. The edit is made as text, placing the entry beside the existing ones in the same style and leaving the rest of the file alone, and declines rather than clobbers a config it cannot place an entry in.
- 7b71ddf: Settle `IFC` and `IFNC` string comparisons. Both strings are read from the line's text, quoted or bare (a blank argument is an empty string), and compared exactly, so `ifc \1,\2` and the usual missing-argument test `ifnc "\1",""` in a macro body pick their arm once the arguments are substituted. A line the comparison cannot be read from with confidence, such as unquoted text with spaces in it or an argument not yet substituted, is left undecided as before.
- Analyse the statement an `iif` makes conditional. `iif DEBUG move.l #1,d0` is now looked at as the `move.l` it is, so the rules that read an instruction see it, and a rewrite keeps the label, the `iif <condition>` and the comment in front of it. What the statement does is treated as something that may not happen: a write it makes does not make an earlier write dead, what it would set in the condition codes does not replace what was there, and a jump or return in it leaves the next line reachable. It is not treated as part of a sequence, so rules that combine neighbouring instructions do not join it to its neighbours, and a rewrite that would span lines or remove it is left as a suggestion. A statement whose condition is known not to hold, such as `iif 0`, is left out of the flow and the symbols as an `if 0` arm is.
- 36b3909: Add `portability/include-case`, flagging an `INCLUDE` or `INCBIN` path whose case differs from the file on disk. On a case-insensitive file system (macOS, Windows) the assembler accepts `include "Exec/Types.i"` for `exec/types.i` and the author never hears of it, but the project does not build on a case-sensitive one such as Linux or a build server. The path as it is on disk is offered as a safe fix. Rules read only text, so the command line and the language server work out what each include is called on disk beforehand and hand it over as a new `FileFacts` argument to `lintSource` and `lintParsedFile`; the rule stays silent where none was given, as for text from standard input. Adds the `portability` category's first rule, `includeCaseOnDisk` and `needsIncludeCase`, and lets a fix rewrite a directive line as the same directive.
- 36b3909: Add `includePaths` to the project config: the directories the assembler is given to find includes in (`vasm -I`), absolute or relative to the config file, and the same setting the assembly language server has. The linter follows each `include` it finds, beside the including file and then through those paths in order, and through what those files include, and reads what it reaches for the constants and macros it defines and the names it refers to, without ever linting it. This lets a project use includes that live outside it, such as NDK files shared between projects, whose location is given to the assembler and appears nowhere in the source. Case is left to the file system, as it would be for the assembler run there. An include that names its own way, such as `../shared/hw.i`, is followed with no configuration. Following is capped at 4000 files.
- cb84cd3: Add `suspicious/dbra-word-counter` and `suspicious/infinite-loop`. The first flags a `DBcc` loop whose counter is a known constant with bits above bit 15 set on entry, since `DBcc` only counts the low word (`move.l #100000,d0` runs 34465 times, `moveq #-1,d0` runs 65536); a counter packed with an outer count and reached with `SWAP` is left alone. The second flags a loop whose every exit is a conditional branch on registers the loop never writes, so it exits on the first pass or never. Loops with no exit, tests that read memory, and loops containing calls, traps, macros or `DBcc` are not reported.
- ca3b18b: Expand macros defined in other files. The project index now carries macro definitions alongside constants, and a call to a macro the file does not define itself is expanded from the project's definition, so macros from includes are seen through like local ones. As with constants, a name is answered only where every definition of it in the project has the same body; a macro defined two ways stays opaque. The file's own definition takes precedence. This is a match by name across the project, not a walk of the include graph.
- 3d61532: Share the options that describe how the source is assembled. `processors`, `includePaths` and `caseSensitive` are read from `.m68krc.json` by the linter, its language server and the assembly server, layered under the tool's own config, and `-nocase`, `-I` and `-m` in the vasm arguments are read back as those options. The assembly server now passes `-nocase` to vasm when case is folded by setting, without repeating arguments already given, and warns when `caseSensitive: true` contradicts a `-nocase` argument. The linter CLI now honours `caseSensitive` in its config, which it previously ignored.

  The assembly server now finds `.m68krc.json` by walking up from the workspace folder, as the linter does, rather than only in the folder itself.

  Relative `includePaths` in `.m68krc.json` are taken from the file's directory by the assembly server too, so all three tools agree, and vasm is given the resolved paths.

- ca3b18b: See through simple macro calls. A macro defined in the same file is now expanded, using the shared expansion in m68k-parser, and when it expands to a straight run of instructions the register, flag and stack analyses use those instead of treating the call as opaque. This sharpens every rule built on them, such as `dead-register-write`, `stale-condition-code`, `unbalanced-stack`, `unused-comparison` and `unneeded-register-save`. Expansion is by text substitution as the assembler does it, so parameters that build names (`d\1`), `NARG` and nested macro calls all work. Calls that cannot be expanded (macros from includes, expansions containing labels, branches, conditional assembly or calls to unknown macros, too few arguments, or self-recursion) stay opaque exactly as before. The Amiga NDK's `PUSHM` and `POPM` are understood as `movem.l` to and from the stack, including `POPM` with no register list, which restores what the matching `PUSHM` saved; `suspicious/movem-restore-mismatch` now compares their lists too.
- 9ca205d: Add `sourceRoot`, the directory relative paths in the source resolve from, to `.m68krc.json`, `m68k-lint.json` (where it overrides the shared file's) and `m68k.sourceRoot` in editor settings. vasm is run there instead of in each file's own directory, so a project whose includes are named from where its build runs (`include "lib/defs.i"`) no longer gets false include errors, and the linter and both language servers look there for includes. Unset keeps the previous behaviour.

  A relative `-I` in `vasm.args` is tried from the source root, where vasm is run, and then from the main source's directory, as vasm does, and the linter reads it the same way.

- a8034b3: Add `suspicious/string-escape-sequence`, which warns about backslash escapes such as `\n` or `\t` in string data (`dc.b "Hello\n",0`). vasm only interprets escape sequences when given `-esc`; otherwise the backslash and letter are two characters of data, so the string assembles without complaint and the wrong bytes are emitted. The finding suggests writing the value as its own element (`dc.b "Hello",10,0`). Macro bodies are not checked, since a backslash there starts a parameter. Set `escapeSequences: true` for a project assembled with `-esc`, which turns it off.
- 3d61532: Keep symbol case by default, as vasm does. `Foo` and `foo` are different symbols unless the assembler was given `-nocase`; the linter used to treat every name as case-insensitive, so two symbols differing only in case merged into one, giving a false conflict for constants, hiding unused labels, and letting a branch to `.Loop` land on `.loop`. Constants, labels, local labels and macros now keep their case throughout, and instruction, directive and register names are still matched without regard to case.

  A project assembled with `-nocase` says so: `caseSensitive: false` in `m68k-lint.json`, or in the assembly server's config, which also follows a `-nocase` among the vasm arguments when the setting is unset. 68kcounter's `parse` takes `{ caseSensitive: false }`. The assembly server re-reads every document when the setting changes. `m68k-parser` gains `symbolKey`, and `analyzeLocalLabelScopes` takes the option. Macro names in 68kcounter and the assembly server, which used to ignore case, now keep it like other symbols. `opt c-` in the source is not read yet.

- cb84cd3: Add `suspicious/unbalanced-stack`, flagging an `rts`, `rte` or `rtr` reached with more pushed than popped, and a point reached by paths that disagree about the stack depth. Follows `-(sp)`, `(sp)+`, `MOVEM`, `PEA`, `LINK`/`UNLK` and adjustments of `SP` from each global label, and goes quiet at anything it cannot follow, such as a macro. Popping more than was pushed is not reported, since removing caller-pushed arguments is a valid convention.
- f32f4d5: Add `optimization/unneeded-register-save`, flagging registers that are saved on entry and restored on exit but never changed in between, and suggesting the trimmed list. Reads `PUSHM` and `POPM` as `movem.l` to and from the stack as well as `movem` itself. Only leaf code is examined: a call, trap, macro or unknown jump in between could change the register, and anything addressing the stack by offset is left alone since trimming the list would move the offsets. `suspicious/unbalanced-stack` now understands `PUSHM` and `POPM` too.
- f32f4d5: Add `suspicious/unused-comparison`, flagging a `CMP`, `CMPA`, `CMPI`, `CMPM`, `TST` or `BTST` whose condition codes are overwritten before any branch, `Scc` or `DBcc` could read them, usually a branch that was never written or was deleted in an edit. Flags reaching a call, a macro or a return are left alone (so `tst.l d0` before `rts` is fine), as is `TST` on memory, which is used deliberately to touch hardware.
- a61605e: Add `suspicious/unused-macro`, flagging a macro that nothing in the project invokes. Off by default and only checked when a project-wide reference index is available, for the same reason as `unused-global-label`: a macro is usually defined in an include file for every source to draw on. Both `NAME: MACRO` and `MACRO NAME` definitions are recognised, invocations match without regard to case, and a call from inside another macro counts as a use. The project reference index gains an `invokes` lookup for macro calls, which are mnemonics rather than operand symbols.

### Patch Changes

- cb84cd3: Resolve local labels within their own routine when building the control-flow graph. A branch to `.loop` used to land on the last `.loop` defined anywhere in the file, which gave wrong answers to every rule that follows control flow (dead register writes, stale condition codes, unreachable code) whenever two routines reused a local label name.
- 530995e: Model more instructions when following registers. `Scc`, `PEA`, `CHK`, `NBCD`, `ADDX`, `SUBX`, `ABCD`, `SBCD`, `CMPM` and `MOVEP` used to be treated as having unknown effects, which made every rule that follows registers stand down around them; they now say what they read and write. A shift or rotate written with one operand, such as `lsr.w d0`, was recorded as reading the register without changing it, so a constant held there was still believed after the shift; it now counts as a write. Found by checking the linter's register model against the language server's over the instruction corpus, where they now agree on all but a design difference over the implicit stack pointer.
- 530995e: Treat `RTD` as a return in flow analysis. It was treated as falling through to the next instruction, so code after it looked reachable and register and flag state was carried across it. Return handling is now decided in one place rather than by separate lists of return mnemonics in several rules.
- 530995e: Resolve local labels the same way everywhere. The linter, the register analysis in the language server and its symbol lookups each decided for themselves which label a local one belongs to, and they disagreed: one let a label defined with `equ` start a new routine, one counted only labels on code, one counted any label. All now use the parser's rule, under which a label that defines a symbol does not start a routine while a label on data does.
- 581f5d4: Count names that a macro call builds when deciding whether a label or constant is used. `CALLINIT Sound` over a macro containing `jsr Init_\1` refers to `Init_Sound`, but only the call was scanned, so `suspicious/unused-global-label` and `suspicious/unused-constant` reported a routine or constant that was in fact used. Each call to a macro the project defines is now expanded when the reference index is built, and the names in the result count as references. This can only add references, so it can only remove false reports.
- 2daedf1: Fixes found by checking against a real vasm. `trap #n` is two bytes in 68kcounter, not four. `movea.w #$8000,a0` (and other unsigned word values from `$8000` to `$ffff`) is suggested as `lea -32768.w,a0`, since vasm rejects `lea $8000.w`. In `dc.w`, `dc.l` and other sizes wider than a byte, a string is one character constant, so `dc.w "ab"` is one word and `dc.l "abcd"` one long, not one element per character; only `dc.b` counts characters.
- Updated dependencies [2483db0]
- Updated dependencies [530995e]
- Updated dependencies [ca3b18b]
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
  - 68kcounter@5.1.0
  - m68k-parser@2.1.0

## 2.1.0

### Minor Changes

- b02a898: Add `suspicious/unreachable-code`, flagging instructions that nothing can branch to or fall into, usually left behind after an edit. Deliberately conservative: code under a global label, under a referenced local label, straight after a computed jump (an inline jump table) or after a macro invocation is never reported. An unreferenced local label on unreachable code is reported once, as unreachable, rather than also as `unused-local-label` (unless the new rule is turned off).
- d29fda4: Add `suspicious/unused-constant`, flagging an `equ`/`=` constant referenced nowhere in the project. Off by default and only checked when a project-wide reference index is available, for the same reason `unused-global-label` is opt-in: a constant has no scope of its own, and a header full of hardware equates is written expecting most of it to go unused within its own file. Uses the same project reference index as `unused-global-label`, so it adds no further indexing cost when the two are enabled together.
- d29fda4: Add `suspicious/unused-global-label`, flagging a global label referenced nowhere in the project. Off by default and only checked when a project-wide reference index is available: a label with no reference the index can see may still be a linker-specified entry point or a hardware vector table entry placed by address rather than by name, neither of which is visible to source analysis. XDEF and XREF need no special handling -- their operands are ordinary symbol references, so an exported or imported name already counts as used. `_start` is exempt outright as the conventional linker entry point name.

  Add `buildProjectReferences` and thread an optional `ProjectReferences` index through `lintParsedFile`/`lintSource` and `RuleContext.projectReferences`, built from the same project scan `buildProjectSymbols` already does. Building it re-parses every project file on top of the constant index's own pass, so both the CLI and the language server now build it only when `needsProjectReferences(config)` says a live rule actually reads it -- in practice, only when `unused-global-label` itself is enabled. Project indexing overall can still be turned off with `projectSymbols: false`.

- d29fda4: Add `suspicious/unused-local-label`, flagging a local label (`.loop`, `loop$`) that nothing in its routine refers to. Restricted to local labels, since their scope guarantees nothing outside the enclosing global label can reference them; a global label with no in-file reference is left alone, as it may still be reached from another module or a jump table. Matching follows the same scoping an assembler uses -- the nearest preceding global label -- so two routines may each have their own unused `.loop` without one hiding the other.

### Patch Changes

- a76bfa3: Publish a bundled build instead of one output file per source module, and share the CLI's file walking and glob matching with the language servers. The package entry points, the `m68k-lint` binary and the `m68k-lint/project-config` subpath are unchanged; internal module paths under `dist/` were never part of the public exports map. Glob patterns for inputs and `ignorePatterns` are now matched with minimatch, so brace expansion and other standard glob syntax work where the previous small glob subset did not.
- a76bfa3: `m68k-lint --init` now writes a `$schema` URL pinned to the CLI's version instead of a path into `node_modules`, which rarely exists in an assembly project. The schema `$id` no longer points at the archived standalone repository. The VS Code extension now bundles the schema and validates `m68k-lint.json` and `.m68klintrc.json` against it offline, rather than fetching it from that repository.

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

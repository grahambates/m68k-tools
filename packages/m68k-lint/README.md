# m68k-lint

Extensible static analysis and linting for Motorola 68k assembly, built on
[`m68k-parser`](https://github.com/grahambates/m68k-tools/tree/main/packages/m68k-parser).

142 built-in rules across correctness, suspicious-construct, optimization and
style checks, backed by condition-code liveness, register liveness and constant
propagation. Optimization suggestions on `mc68000` carry **exact** measured
size and cycle deltas from [`68kcounter`](https://github.com/grahambates/m68k-tools/tree/main/packages/68kcounter),
so a claimed improvement is a measured one.

```
game.s:42:2
suggestion  Immediate 42 fits the MOVEQ signed 8-bit range  [optimization/prefer-moveq]
	move.l	#42,d3
action: Use moveq #42,d3 (safe)
	moveq	#42,d3
saves: 4 bytes, 8(2,0) cycles, (overall improvement)
```

A finding names the lines it covers rather than a character range, since a match
is a run of instructions and never a substring. The replacement is shown as it
would be written, carrying the indentation and operand column of what it
replaces.

Measurements read as savings in the `cycles(reads,writes)` shape the 68k manuals
use, so bigger is better; a cost shows as a negative saving. With colour, savings
are green, costs red, and both the matched source and the replacement are syntax
highlighted.

## Install

```sh
npm install -g m68k-lint
```

Requires Node 22.15.1 or newer.

## Command line

```sh
m68k-lint game.s
m68k-lint src/
m68k-lint "src/**/*.asm"
m68k-lint --platform amiga --cpu mc68000 src/
```

Directories and globs recursively discover `.s`, `.asm` and `.i` by default;
explicit file paths are always linted whatever their suffix.

| Option                                   | Description                                                    |
| ---------------------------------------- | -------------------------------------------------------------- |
| `--config <path>`                        | Use a specific JSON config file                                |
| `--no-config`                            | Disable config-file discovery                                  |
| `--ext <ext,...>`                        | Extensions for directory/glob discovery (default `.s,.asm,.i`) |
| `--ignore-pattern <glob>`                | Ignore matching files (repeatable)                             |
| `--cpu <cpu,...>`                        | Target processor(s), default `mc68000`                         |
| `--platform <generic\|amiga\|atari>`     | Target platform, default `generic`                             |
| `--preset <name,...>`                    | Enable rule presets: `recommended`, `style`                    |
| `--goal <balanced\|speed\|size>`         | Filter known optimization trade-offs                           |
| `--impact` / `--no-impact`               | Enable/disable exact 68000 measurement                         |
| `--inline-config` / `--no-inline-config` | Honour `m68k-lint` comment directives                          |
| `--impact-summary`                       | Summarize measured outcomes by rule                            |
| `--audit-rule-impact`                    | Run the representative 68000 timing audit                      |
| `--only <category,...>`                  | Run only selected rule categories                              |
| `--disable-category <category>`          | Disable a category (repeatable)                                |
| `--rule <id>=<setting>`                  | Override a rule: `off\|error\|warning\|suggestion\|info`       |
| `--fix`                                  | Apply safe suggestions and rewrite the files                   |
| `--fix-conditional`                      | Also apply conditional ones; read their notes first            |
| `--fix-annotate`                         | Keep the original, commented out, above an opaque rewrite      |
| `-i`, `--fix-interactive`                | Review each finding and choose what to do with it              |
| `--fix-dry-run`                          | Report what `--fix` would change, writing nothing              |
| `--format <pretty\|json>`                | Output format, default `pretty`                                |
| `--fail-on <severity>`                   | Exit 1 at this severity or higher, default `error`             |
| `--init`                                 | Create a project config file interactively                     |
| `--list-rules`                           | List built-in rules and exit                                   |
| `--color` / `--no-color`                 | Force or disable ANSI colours; default TTY only                |
| `-h`, `--help` / `-v`, `--version`       | Show help or version                                           |

`error`-severity diagnostics exit 1; warnings and suggestions are printed but do
not fail the command. `--fail-on` makes CI stricter. Usage and configuration
errors exit 2. A file this parser cannot fully read is reported as such but does
not fail the run — see [Syntax errors](#syntax-errors).

## Library

```ts
import { lintSource } from "m68k-lint";

const diagnostics = lintSource(
  ["\tmovea.l d0,a0", "\tbeq     .null", ".null:", "\trts"].join("\n"),
);
```

`lintSource` returns a `Diagnostic[]` sorted by source position. `lintParsedFile`
takes an already-parsed file when you are reusing a parse.

> m68k-parser follows traditional assembler column rules, so a mnemonic must be
> indented. A token in column 0 is a label: `move.l #42,d3` at column 0 parses as
> a label named `move`, not an instruction.

The analyses are available directly for tooling that wants the dataflow rather
than the findings:

```ts
import { parseFile } from "m68k-parser";
import { DefaultRuleContext } from "m68k-lint";

const source = "\tadd.l  d0,d1\n\tmove.l d2,d3\n\trts\n";
const ctx = new DefaultRuleContext(parseFile(source), source, {
  processors: ["mc68000"],
});

ctx.flags.isLiveAfter(0, "Z"); // "dead"  - MOVE overwrites it
ctx.flags.isLiveAfter(0, "X"); // "unknown" - MOVE preserves X, RTS escapes
ctx.registers.isLiveAfter(0, "d0"); // "dead" | "live" | "unknown"
```

## Configuration

```sh
m68k-lint --init
```

Asks for platform, processors, optimization goal and the style preset, then
writes `m68k-lint.json`. Source globs are suggested from where the assembly
files actually are: `**` when any sit in the project root, otherwise the
subdirectories that contain them. Only
answers that differ from the defaults are written, and an ignore entry naming a
bare directory gets the trailing `/**` it needs to match anything. It shows the
file and asks before writing, and asks again before overwriting an existing one.

The CLI searches upward for `m68k-lint.json` or `.m68klintrc.json`. Precedence is
defaults < config file < CLI, with `rules` merged so `--rule` overrides only the
named rule. File and ignore patterns are relative to the config file's directory.

```json
{
  "$schema": "./node_modules/m68k-lint/m68k-lint.schema.json",
  "processors": ["mc68000"],
  "platform": "amiga",
  "goal": "balanced",
  "measureImpact": true,
  "presets": ["recommended"],
  "extensions": [".s", ".asm", ".i"],
  "files": ["src/**", "include/**"],
  "ignores": ["generated/**", "vendor/**"],
  "categories": { "style": false },
  "rules": {
    "suspicious/nop": "off",
    "optimization/bset-to-tas": "off"
  }
}
```

`files` is used when no input path is given on the command line. `include` and
`ignorePatterns` are accepted as aliases of `files` and `ignores`.
`node_modules/**` and `.git/**` are always ignored during discovery.

## Inline directives

```asm
    ; m68k-lint-disable optimization/prefer-moveq
    move.l  #42,d0
    ; m68k-lint-enable optimization/prefer-moveq

    ; m68k-lint-disable-next-line optimization/prefer-moveq
    move.l  #43,d1

    move.l  #44,d2 ; m68k-lint-disable-line optimization/prefer-moveq

* m68k-lint-disable-next-line -- hardware-specific timing sequence
    nop
```

Directives are read from `;` comments and from `*` comments in column 0. Multiple
rule IDs may be comma- or whitespace-separated; a directive with no IDs applies to
every rule; an optional reason may follow `--`.

`disable` stays active until a matching `enable`. `disable-line` affects the
current physical line, `disable-next-line` the following one. Projects that need
centrally enforced configuration can set `"inlineConfig": false` or pass
`--no-inline-config`.

## Constants from other files

Most rules need to know what a constant is worth, and most constants live in an
include rather than in the file being linted. Reconstructing the real include
hierarchy would need the program's entry point and the assembler's include
paths, neither of which is in the source, so m68k-lint instead indexes every
assembly and header file under the project and resolves names from that.

The index only answers for a name the whole project agrees on. Where two files
define one differently — a debug and a release configuration, per-machine
hardware headers — the name stays unknown and the rules that depend on it stay
silent, exactly as they were before the index existed. It can turn "unknown"
into "known", never "known" into "wrong", because a misresolved constant would
make rules fire confidently and wrongly.

Any diagnostic that depended on a value from another file names the file it came
from:

```
notes:
 - Resolved from outside this file: SHIFT_COUNT = 32 (from include/hardware.i).
```

Set `"projectSymbols": false` to analyse each file strictly on its own.

## Rules

See [`docs/rules.md`](docs/rules.md) for the full generated table, or run
`m68k-lint --list-rules`.

| Category       | Count | Purpose                                                     |
| -------------- | ----- | ----------------------------------------------------------- |
| `correctness`  | 3     | Valid assembly with a provable semantic or runtime problem  |
| `suspicious`   | 12    | Valid code that may be intentional but is easy to misread   |
| `optimization` | 110   | Smaller or faster equivalents, gated on target and liveness |
| `style`        | 7     | Subjective conventions, opt-in                              |

`severity`, `confidence` and `applicability` are independent. Applicability is
always explicit:

- **safe** — the replacement is equivalent and every observable difference is
  proven dead.
- **conditional** — equivalent under a stated condition the linter cannot prove.
- **manual** — no single mechanical rewrite exists, so there is nothing to
  offer: a label inside the matched code may be an entry point other code
  branches to, or the finding is a question about intent rather than a
  substitution.

A replacement stands in for whole lines, so a label on the first of them is
carried across — it still points at the same instruction — and a label further
into the match makes the finding manual, because a run collapsing to fewer lines
leaves nowhere for a label that pointed into the middle of it. Deleting a
labelled instruction leaves the label behind on its own.

Trailing comments are carried across too, keeping the spacing the author chose.
Where several matched lines collapse into fewer, comments with no line left to
sit beside are kept on their own rather than dropped.

A rewrite is withheld only when there is none to write. Where the text is known
and its correctness rests on something statable but unprovable — a callee that
must not read arguments relative to SP, a device that must tolerate a wider
access — that is `conditional`, and the replacement is given along with the
condition.

## Applying fixes

`--fix` rewrites files in place, applying `safe` suggestions until nothing more
changes. `--fix-conditional` also applies `conditional` ones — read their notes
first, since each rests on an assumption the linter has stated but cannot prove.
`--fix-dry-run` reports what would change and writes nothing.

Applicability and outcome are separate questions. `safe` says a rewrite means
the same thing; it says nothing about whether it is worth making. So only
measured improvements are applied by default. A trade-off — equivalent, but
costing bytes to save cycles — is a choice about what the code is for, and
becomes applicable once `--goal speed` or `--goal size` says which resource
matters, since the goal filter has already dropped the ones that hurt it. A
neutral rewrite is never applied: changing the file for no measured gain is
churn. A suggestion with no measurement at all, such as removing a dead write,
is always eligible.

Only suggestions carrying replacement text are applied, and a rule declines to
offer one wherever a faithful rewrite is impossible: a label in the middle of a
matched run, or a directive inside it. The replacement already carries the
indentation, operand column, label and comments of the lines it replaces.

`--fix-annotate` keeps the original above a rewrite that is hard to read back,
commented out:

```
	; was:
	; asr.w	#8,d0
	;------------------------------
	move.w	d0,-(sp)
	move.b	(sp)+,d0
	ext.w	d0
	;------------------------------
```

Two things trigger it, both measurable: the replacement has more lines than what
it replaces, or it dropped a name that the code no longer mentions. Ordinary
one-for-one rewrites are left plain.

`-i` / `--fix-interactive` reviews findings one at a time instead, showing each
as it would be reported and asking what to do:

| key |                                                            |
| --- | ---------------------------------------------------------- |
| `y` | apply the rewrite                                          |
| `Y` | apply every remaining finding of this rule                 |
| `n` | skip                                                       |
| `N` | skip every remaining finding of this rule                  |
| `a` | allow here: write a directive beside this code             |
| `d` | disable the rule for the whole project, in the config file |
| `q` | stop; decisions already made still stand                   |

Two things vary: whether an answer covers one finding or the whole rule, and
whether it lasts for this run or is written down.

|              | this occurrence | this rule |
| ------------ | --------------- | --------- |
| this run     | `y` / `n`       | `Y` / `N` |
| written down | `a`             | `d`       |

`Y` and `N` settle a rule for the rest of the session and leave nothing behind:
the next run asks again. That is what separates `N` from `d`, which writes the
rule off in `m68k-lint.json` for good, preserving anything already in the file.

`a` and `d` are the answers that persist, one against a single line and one
against everything. Both are the useful answers for a finding with no rewrite,
where the question is whether the code is meant to be that way rather than how
to change it.

Questions come in file order, and edits are made afterwards from the bottom up,
which is the only order in which line numbers stay valid.

Fixes are applied from the bottom of the file up so earlier line numbers stay
valid, and overlapping ones are left for the next round rather than dropped.
Rounds repeat because one rewrite exposes another, up to a limit. If a round
produced source that no longer parsed it is rolled back and the run stops,
which should never happen and is cheap insurance if it does.

## Goals

```sh
m68k-lint --goal balanced game.s   # default: every valid suggestion, trade-offs included
m68k-lint --goal speed game.s      # suppress suggestions known to be slower
m68k-lint --goal size game.s       # suppress known code-size increases
```

Unknown performance is never silently treated as a regression.

`--goal speed` and `--goal size` filter optimization suggestions on measured
impact: a rewrite that costs bytes is not offered in a size-focused run, and one
that costs cycles is not offered in a speed-focused run. A goal excludes what
costs the resource it cares about, not everything that helps the other one, so a
rewrite that is free on one axis and better on the other appears in both.

Some rewrites only make sense in one direction, and a few have a useful inverse:
doubling a register twice is faster than shifting it left by two, and shifting
is two bytes smaller. Those rules declare which goal they serve, and an inverse
names the rule it undoes. Only one of a pair is ever live — otherwise each would
recreate the other's input, and applying fixes repeatedly would never settle. A
balanced run keeps the canonical direction, which is the rule that does not
declare itself an inverse.

The declaration exists because impact is measured only for 68000 targets and
only when measurement is enabled. Where figures do exist they decide instead,
per suggestion: cost is a property of the instance rather than the rule, and
`muls.w #2` and `muls.w #10` go through the same rule while only one of them
costs bytes. The declaration is checked against the audit, so a rule cannot
claim to serve a goal the measurements contradict.

## Scope

The linter deliberately does not duplicate assembler validation. Illegal
instruction, size and addressing-mode combinations belong to the assembler unless
the linter can add materially better semantic or contextual information.

### Syntax errors

Syntax errors are not reported for the same reason, and because this parser is
deliberately more permissive than any one assembler: a line it cannot read may
be perfectly valid to yours. A file that does not fully parse is noted once, so
an empty result is not mistaken for a verified one, and does not fail the run:

```
game.s: 3 lines could not be parsed; findings for this file may be incomplete.
```

## Presets

`recommended` is the default baseline. `style` enables the subjective convention
rules. A handful of alias-preference rules are individually opt-in rather than
part of any preset, because they conflict in pairs — do not enable both sides of
`prefer-dbra` / `prefer-dbf` at once. Explicit rule settings beat presets.

## Platform modes

`--platform` adds platform-specific correctness and footgun rules on top of
generic 68k linting: `amiga`, `atari`, or `generic` (the default).

Amiga mode covers unsupported `TAS`, custom-chip register access direction, and
absolute addresses outside the expected vector, custom-chip and CIA regions (the
common typo where an intended immediate is written without `#`).

Atari mode applies the same absolute-address heuristic against the Atari map,
covering the memory controller, video, DMA, PSG, blitter, both MFPs and the
keyboard and MIDI ACIAs. Hardware registers there are conventionally written as
a sign-extended absolute short, so `$FFFF8240.W`, `$FF8240` and the negative
word `-32192` all name the same register and are all recognised — the 68000
address bus is 24 bits and ignores A24-A31.

One identifier covers the family rather than one per model. Model-specific
hardware sits inside the same blocks, so splitting would only narrow the map and
produce false positives on code targeting a range of machines, and the 68030 in
the TT and Falcon is already expressible as `--cpu mc68030`.

Custom-register checks understand include-file conventions, resolving both
`DMACONR(a6)` after `lea CUSTOM,a6` and `DMACONR+CUSTOM` to `$DFF002`.
Project-local symbol definitions take precedence.

## Optimization impact

With `mc68000` selected, replacements are measured through `68kcounter` for
encoded bytes, CPU cycles, and read/write bus cycles. Exact deltas are classified
as `improvement`, `tradeoff`, `neutral` or `regression`.

Measurement is best-effort: unsupported spellings and path-dependent timings omit
the affected metric rather than suppressing the diagnostic. Rule correctness never
depends on measurement being available. Use `--no-impact` to turn it off.

Where an exact measurement contradicts a historical source claim, both are kept
so the discrepancy is auditable. `--impact-summary` groups measured outcomes by
rule, regressions first — useful for finding historical rules whose stated
benefit does not hold for the source forms a project actually contains.

### Rule impact audit

```sh
pnpm run audit:impact   # or: m68k-lint --audit-rule-impact
```

Runs one representative example for every optimization rule.
mc68000 cases are measured; rules a 68000-only counter cannot measure must carry
an explicit exemption. Missing cases, examples that no longer trigger,
unmeasured rules and measured regressions all fail the command, so a new rule
cannot silently escape validation.

This is a timing smoke test, not a semantic proof. Value, CCR, register-liveness,
aliasing and control-flow correctness remain the job of the normal rule tests.

## Analysis

Findings are emitted, never edits. Cross-line knowledge lives behind
`RuleContext` rather than inside individual rules, and analysis is conservative:
inability to prove a fact yields `unknown`, never an optimistic assumption.

- **Constants and symbols** — constant-expression evaluation, a file-local table
  for `equ` and `=`, and chained resolution with cycle protection. `set` is
  deliberately excluded because it is mutable and order-sensitive.
- **Control flow** — instruction-level successors and predecessors for
  fallthrough and direct branches, with direct `JMP label` resolved in-file.
  `RTS`, `RTE`, `RTR`, `STOP`, unresolved branches and indirect jumps are escape
  points. Calls keep their fallthrough edge but are opaque CCR boundaries.
- **Condition codes** — `X`, `N`, `Z`, `V` and `C` modelled individually, with
  liveness and reaching definitions.
- **Registers** — per-register liveness, definite constants, constant and copy
  propagation, bit-level use tracking so a rewrite that only differs in bits
  nothing reads is still provably safe, and dead data-register discovery for
  scratch-register optimisations.
- **Blocks** — macro bodies, `REPT` and the arms of an `IF`/`ELSE` are separate
  regions rather than straight-line code, so a sequence is never matched across
  a boundary the assembler may not lay out that way, and a macro invocation is
  treated as code whose effects are unknown.

Two conservative cases worth knowing, because they surprise people:

```asm
    add.l d0,d1
    rts
```

ADD's flags are `unknown`, not dead — the caller may observe the returned CCR.
The same applies to registers: a register live at `RTS` is `unknown`, since it
may be a return value.

```asm
    add.l  d0,d1
    move.l d2,d3
    rts
```

`N/Z/V/C` are provably dead because MOVE overwrites them. `X` stays `unknown`:
MOVE preserves X and the return escapes analysis.

## Provenance

Rule IDs are descriptive rather than source-named; provenance lives in rule
metadata.

Each corpus was audited rather than trusted: rows have been rejected for
computing the wrong value, for using encodings that do not exist, and for
claiming savings that measurement disproves.

- **ASP68K** — the first corpus.
- **Flamewing's M68000 peephole list**
- **vasm, 68000 Tricks and Traps, EAB discussion**

Which corpus a rule came from is recorded in its `docs.source` metadata and
listed in [docs/rules.md](docs/rules.md). The per-corpus review write-ups are
working notes rather than shipped documentation.

`docs/` holds the documentation shipped with the package. The audit write-ups,
source reviews, impact-measurement methodology and rule roadmap behind the above
are working notes, kept in an untracked `notes/` directory.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run typecheck     # tsc over src and src/test
pnpm run lint          # eslint
pnpm run format        # prettier --write
pnpm test
pnpm run build
pnpm run audit:impact
pnpm run docs:rules    # regenerate docs/rules.md
```

Run these commands from `packages/m68k-lint` after installing from the repository root. Build workspace dependencies first with `pnpm --dir ../.. build`. Root CI runs the checks; regenerate rule documentation when rules change. `pnpm run lint:fix` and `pnpm run format:check` are also
available.

`pnpm run verify:semantics` is separate and not part of CI. It runs suggested
replacements and the code they replace through an emulator and compares
registers, memory and CCR, which catches a rewrite that is wrong rather than
merely unprofitable. It is sharded across child processes because the
interpreter it uses becomes unreliable after a few hundred instantiations.

Rule fixtures in `src/test` are written in compact column-zero form and indented
by the helpers in `src/test/helpers.ts`, which share one indent rule with the
impact audit. Use `lint()` / `ids()` from that module rather than calling
`lintSource` directly.

## License

MIT

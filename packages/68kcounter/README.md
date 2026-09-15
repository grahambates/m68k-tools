![Logo](images/icon.png)

# 68k Counter

Analyses 68000 assembly source to profile resource and size data. For each instruction it will tell you.

- CPU cycles
- Bus read cycles
- Bus write cycles
- Size in bytes

## Usage:

### Web app

You can try out the tool in a <a href="https://68kcounter-web.vercel.app/">web-based version</a>.

### CLI

To analyse a source file run:

`npx 68kcounter mysource.s`

This will output each line prefixed with profile data in the following format:

`[cycles]([reads]/[writes]) [size]`

See `npx 68kcounter --help` for more options.

### Target CPU

The counter targets the **68000** by default. Pass `--cpu 68020` to select the
68020 (or `--cpu 68030` for the 68030), or declare it in the source with a `machine mc68020` (or bare `mc68020`)
directive, which overrides the flag for that file.

> **68020 status:** 68020 timings are transcribed from the MC68020 User's
> Manual (§8.2). Because 68020 timing depends on the instruction cache, the
> manual gives a cache-case and a worst-case (cache miss) figure. A single case
> is reported — **worst case by default**, or the cache case with `--cache`.
> (This keeps a line's value list meaning the same as on the 68000: one value
> per outcome, e.g. a branch's taken / not-taken.) The manual's best case
> assumes pipeline overlap between instructions and is not modelled. 68020 bus
> cycles are shown as `reads/prefetch/writes` (operand reads and
> instruction-stream prefetches are counted separately — both matter for bus
> contention), whereas the 68000 shows `reads/writes` with instruction fetches
> folded into reads. The **full 68020 integer instruction set** is covered,
> including the 68020-only additions: bit-field (`bfextu`, `bfins`, …), 64-bit
> `mul.l`/`div.l`, `chk2`/`cmp2`, `cas`/`cas2`, `pack`/`unpk`, `bkpt`, `rtd`,
> `extb`, and the supervisor moves `movec`/`moves`. FPU (68881/68882) and
> PMMU instructions are out of scope — they parse and are shown with sizes but
> without a timing.

### VS Code extension

Available as <a href="https://marketplace.visualstudio.com/items?itemName=gigabates.68kcounter">VS Code extension</a> to provide live annotations and totals.

![Output window screenshot](https://raw.githubusercontent.com/grahambates/m68k-tools/main/apps/68kcounter-vscode/images/demo.gif)

## Limitations:

- Because it analyses your pre-assembled source, it can't take into account
  optimisations made by your assembler.
- Total timings for a whole file are pretty meaningless as it doesn't take
  into account branching etc, but it can be useful for smaller blocks.
- Where timings are based on an 'n' multiplier from an immediate value, it
  will parse simple expressions but doesn't currently substitute constants
  defined elsewhere.
- FPU and PMMU cycle timings are not modelled. See the 68020 timing assumptions above.

### 68030 timings

Select `--cpu 68030`, `{ cpu: "68030" }` in the library, or `machine mc68030` in source. `--cache` / `{ cacheModel: "cache" }` selects the instruction-cache case. The default (`cacheModel: "worst"`, retained for API compatibility) selects the **average no-cache case**, not an absolute worst case.

The data comes from Motorola's [MC68030 User's Manual, section 11.6](https://www.nxp.com/docs/en/reference-manual/MC68030UM-P2.pdf). It assumes two-clock reads/writes and aligned operands. Timings include operand reads, instruction prefetches and writes as separate columns. Operation and effective-address costs are added without head/tail overlap; totals are isolated-instruction estimates, not pipeline simulation. Data-cache hits, MMU table walks, bus contention and additional wait states are not modelled.

Covered families include MOVE/MOVEM/MOVEP, arithmetic and logic, shifts/rotates, bit operations, register bitfields, conditional branches, calls/returns, and common control instructions. Data-dependent multiply/divide use the manual's maximum values; variable shifts retain their possible outcomes. Full-format word/long displacements and memory-indirect pre/post-indexing are supported, including PC-relative sources, omitted bases, and MOVE destinations. Known displacements use the smallest encoding that fits; forced displacement-size suffixes and explicit suppressed-register aliases such as `za0` remain unsupported. Unresolved indexed or memory-indirect displacements are left untimed because their encoding cannot be determined. Memory bitfields, CAS2, FPU and MMU timings are not provided. Unsupported forms do not fall back to another CPU's timing data. Byte-size estimation includes full-format and memory-indirect extension words for resolved displacements. Forced displacement widths, suppressed-register aliases and unresolved complex operands still require improved parser/encoding support; their byte sizes remain estimates.

The HTML timing transcription was used as a cross-reference. The manual distinguishes brief and full extension-word rows that have similar textual operand spellings. Its corrected CMPI memory bus counts and displacement prefetch counts are used here. Head/tail values remain available in the cited source for future overlap modelling.

## Development

Requires Node.js 22.15.1 or later at runtime. Use the root-pinned Node version for development. From the monorepo root, run `pnpm install --frozen-lockfile`, `pnpm --filter m68k-parser build`, then `pnpm --filter 68kcounter build` and `pnpm --filter 68kcounter test`.

## License

[MIT](LICENSE).

## Module formats

ESM imports and CommonJS `require` are supported through conditional exports, with matching TypeScript declarations. Existing CommonJS file paths remain available. ESM consumers receive the native `.mjs` entry point.

### 68040 and 68060 cached references

Select `--cpu 68040` / `--cpu 68060`, the matching library `cpu` option, or a `machine mc68040` / `machine mc68060` directive. These CPUs currently always use cached reference costs, regardless of `--cache` or `cacheModel`. Both instruction and data accesses are assumed to hit their caches, with aligned operands. No memory-system or uncached estimate is provided.

The tables are based on [MC68040UM §10.4–6](https://www.nxp.com/docs/en/reference-manual/MC68040UM.pdf) and [MC68060UM §10.4–14](https://www.nxp.com/docs/en/data-sheet/MC68060UM.pdf). The 040 clock column reports the manual's execution-stage lead + base cost; JSON/library results preserve the separate address-calculation and execution fields in `timing.reference.stages`. Pipeline stages overlap, so those fields must not be added together. The 060 reports the manual's instruction-execution reference, without instruction pairing. Branch prediction alternatives have separate labels; word division uses the published maximum cost.

Parentheses show **operand reads/writes**, not external bus transfers or DMA contention. Totals are reference sums, not elapsed sequence times. When reference costs occur, use `totals.timingGroups` (also used by the CLI/extension) rather than the legacy combined `min`/`max` fields, particularly when source directives mix CPU models. These sums must not be used alone to claim a replacement sequence is faster.

Initial coverage includes MOVE/MOVEA/MOVEQ, common arithmetic and logic, register and memory shifts/rotates, comparisons, clear/negate, branches, calls/returns and address calculations. Full-format and memory-indirect costs are supported for covered families. Both CPUs cover ordinary bit operations and word/long MOVEM loads and stores. Bitfields, FPU/MMU operations, cache maintenance, locked accesses, exception handling and several miscellaneous/control-register forms remain untimed. There is no fallback for emulated or unsupported instructions. Missing coverage is exposed as `timingUnavailable` on a line and `incomplete` on its totals; macro expansions preserve this information. The remaining complex-address byte-size limitations described above still apply.

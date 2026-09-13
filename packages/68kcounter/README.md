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
68020, or declare it in the source with a `machine mc68020` (or bare `mc68020`)
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

## Development

Requires Node.js 22.15.1 or later at runtime. Use the root-pinned Node version for development. From the monorepo root, run `pnpm install --frozen-lockfile`, `pnpm --filter m68k-parser build`, then `pnpm --filter 68kcounter build` and `pnpm --filter 68kcounter test`.

## License

[MIT](LICENSE).

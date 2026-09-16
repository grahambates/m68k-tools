---
"m68k-lint": minor
---

Re-verified every CPU-gated optimization rule against 68kcounter, which now
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

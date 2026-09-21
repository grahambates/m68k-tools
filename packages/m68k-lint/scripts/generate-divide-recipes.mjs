#!/usr/bin/env node
/**
 * Generates `src/rules/optimization/generated/divide-recipes.ts`: cheaper ways
 * to do `divu.w #n,Dm` when only the quotient is wanted and the dividend is
 * known to be small.
 *
 * Two families are combined, and for each divisor and dividend range the
 * cheaper wins:
 *
 * - Reciprocal: `mulu.w #m,d0 ; swap d0 ; lsr.w #s,d0`. Needs no scratch
 *   register and works over the whole 16-bit range for most divisors.
 * - Shift/add: MOVE, LSR, ADD, ADDX and SUB on d0 and a scratch register. It
 *   beats the reciprocal for dividends below about 64, and its sequences are
 *   found by `search-divide-shift-recipes.mjs` and read from
 *   `divide-shift-candidates.json`.
 *
 * Nothing from the offline search is trusted: every recipe, of either family,
 * is run here on every dividend in its range (and with the X flag both clear
 * and set where it is read) and must give exactly the quotient. Costs come from
 * 68kcounter, so a test that regenerates this file also catches a change to its
 * timings.
 *
 * The same is done for `divs.w`, which needs more care because it truncates
 * toward zero and so must treat a negative dividend differently:
 *
 * - Signed reciprocal: `muls.w #m,d0 ; swap d0 ; asr.w #s,d0`, then one added if
 *   the dividend was negative, taken from the X flag.
 * - Signed power of two: an arithmetic shift after adding 2^k-1 to a negative
 *   dividend, so that the result rounds toward zero. It is exact for every
 *   32-bit dividend.
 *
 * Run with `pnpm run generate:divide` after building 68kcounter.
 */
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import * as prettier from "prettier";
import { line, mulu, total } from "./divide-common.mjs";
import { compile } from "./divide-eval.mjs";

const OUT = fileURLToPath(
  new URL(
    "../src/rules/optimization/generated/divide-recipes.ts",
    import.meta.url,
  ),
);
const CANDIDATES = new URL("./divide-shift-candidates.json", import.meta.url);

/** Divisors 3..MAX_DIVISOR; powers of two are a shift and have their own rule. */
export const MAX_DIVISOR = 300;
/** Dividend ranges offered, as bits: the dividend is below 2^bits. */
export const RANGES = [4, 5, 6, 8, 12, 16];

/** Whether the recipe gives the exact quotient of every dividend below 2^bits. */
function exact(code, d, bits) {
  const run = compile(code);
  const readsX = code.some((c) => /^(addx|subx)/.test(c));
  const word = code.some((c) => c.startsWith("mulu"));
  for (let x = 0; x < 2 ** bits; x++)
    for (const x0 of readsX ? [0, 1] : [0]) {
      const got = run(x, x0);
      if ((word ? got & 0xffff : got) !== Math.floor(x / d)) return false;
    }
  return true;
}

/** Whether list a sorts before list b. */
function lexicographicallyLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

const template = (text) =>
  text.replace(/\bd0\b/g, "%d").replace(/\bd1\b/g, "%s");

function recipesFor(d, candidates) {
  const options = [];
  for (const bits of RANGES) {
    if (d >= 2 ** bits) continue;
    const found = [];
    const reciprocal = mulu(d, bits);
    if (reciprocal) found.push(reciprocal);
    for (const c of candidates)
      if (c.divisor === d && c.bits === bits)
        found.push({ ...total(c.code), code: c.code });
    let winner;
    for (const r of found) {
      if (!exact(r.code, d, bits))
        throw new Error(
          `not exact for ${d} below 2^${bits}: ${r.code.join(" ; ")}`,
        );
      // Fewer cycles, then fewer bytes, then no scratch register.
      const scratch = r.code.some((c) => /d1/.test(c));
      const rank = [r.cycles, r.bytes, scratch ? 1 : 0];
      if (!winner || lexicographicallyLess(rank, winner.rank))
        winner = {
          bits,
          cycles: r.cycles,
          bytes: r.bytes,
          scratch,
          code: r.code,
          rank,
        };
    }
    if (winner && winner.cycles < line(`divu.w #${d},d0`).cycles)
      options.push(winner);
  }
  // A recipe for a smaller range is only worth offering if it is cheaper than
  // one that covers a larger range.
  return options.filter((o, i) =>
    options.slice(i + 1).every((later) => o.cycles < later.cycles),
  );
}

// ---------------------------------------------------------------------------
// Signed division (DIVS.W)
// ---------------------------------------------------------------------------

/** Signed dividend ranges, as bits: -2^bits <= dividend < 2^bits. 15 is a sign-extended word. */
export const SIGNED_RANGES = [7, 11, 15];
/** DIVS.W's divisor is a signed word, so the largest power of two it can name is 2^14. */
const MAX_SIGNED_POWER = 14;

const truncate = (x, d) => Math.trunc(x / d);

function arithmeticShifts(count) {
  if (count === 0) return [];
  if (count <= 8) return [`asr.w #${count},d0`];
  return ["asr.w #8,d0", `asr.w #${count - 8},d0`];
}

/** Whether the recipe gives the exact truncated quotient, in the low word, of every dividend in range. */
function exactSigned(code, d, bits) {
  const run = compile(code);
  for (let x = -(2 ** bits); x < 2 ** bits; x++)
    for (const x0 of [0, 1])
      if ((run(x >>> 0, x0) & 0xffff) !== (truncate(x, d) & 0xffff))
        return false;
  return true;
}

/**
 * x / d, rounded toward zero, for -2^bits <= x < 2^bits, as
 * `muls.w #m,d0 ; swap d0 ; asr.w #s,d0` plus one if x was negative.
 *
 * With m = ceil(2^(16+s)/d) or a little above, the arithmetic shift gives the
 * floor of the quotient for a positive dividend and one too few for a negative
 * one that does not divide exactly, so adding the sign bit corrects it. The
 * sign is taken by adding the copy of the dividend to itself, which puts bit 15
 * in X, and X is then added in with ADDX. MULS.W's multiplier is a signed word,
 * so m is at most 32767.
 */
function muls(d, bits) {
  const xmax = 2 ** bits - 1;
  const xmin = -(2 ** bits);
  // Dividends where a slightly-too-large multiplier goes wrong first.
  const worst = xmax - ((((xmax - (d - 1)) % d) + d) % d);
  const worstNegative = -Math.floor(2 ** bits / d) * d;
  const critical = [
    xmax,
    worst,
    xmin,
    worstNegative,
    worstNegative - 1,
    worstNegative + 1,
    -d,
    -1,
    1,
    0,
  ];
  let best;
  for (let s = 0; s <= 15; s++) {
    const scale = 2 ** (16 + s);
    const lo = Math.ceil(scale / d);
    const tries = Math.min(
      4096,
      Math.ceil(scale / (d * Math.max(1, xmax))) + 2,
    );
    for (let m = lo; m <= 32767 && m < lo + tries; m++) {
      const quotient = (x) => Math.floor((x * m) / scale) + (x < 0 ? 1 : 0);
      if (
        critical.some(
          (x) => x >= xmin && x <= xmax && quotient(x) !== truncate(x, d),
        )
      )
        continue;
      const code = [
        "move.w d0,d1",
        `muls.w #${m},d0`,
        "swap d0",
        ...arithmeticShifts(s),
        "add.w d1,d1",
        "clr.w d1",
        "addx.w d1,d0",
      ];
      const c = total(code);
      const better =
        !best ||
        c.cycles < best.cycles ||
        (c.cycles === best.cycles && c.bytes < best.bytes);
      if (better && exactSigned(code, d, bits)) best = { ...c, code };
    }
  }
  return best;
}

function signedRecipesFor(d) {
  const options = [];
  for (const bits of SIGNED_RANGES) {
    if (d >= 2 ** bits) continue;
    const winner = muls(d, bits);
    if (winner && winner.cycles < line(`divs.w #${d},d0`).cycles)
      options.push({
        bits,
        cycles: winner.cycles,
        bytes: winner.bytes,
        scratch: true,
        code: winner.code,
      });
  }
  return options.filter((o, i) =>
    options.slice(i + 1).every((later) => o.cycles < later.cycles),
  );
}

/** A seeded generator, so the samples below are the same on every run. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Dividends for checking a power-of-two divide: every small one, the edges of each size, and a spread of the rest. */
function powerOfTwoSamples(k) {
  const p = 2 ** k;
  const out = new Set();
  for (let x = -70000; x <= 70000; x++) out.add(x);
  for (const base of [
    0,
    p,
    2 * p,
    2 ** 15,
    2 ** 16,
    2 ** 15 * p,
    2 ** 30,
    2 ** 31,
  ])
    for (const delta of [-2, -1, 0, 1, 2, p - 1, p, p + 1])
      for (const sign of [1, -1]) {
        const x = sign * base + delta;
        if (x >= -(2 ** 31) && x < 2 ** 31) out.add(x);
      }
  out.add(-(2 ** 31));
  out.add(2 ** 31 - 1);
  const rng = mulberry32(k);
  for (let i = 0; i < 20000; i++)
    out.add(Math.floor(rng() * 2 ** 32) - 2 ** 31);
  return [...out];
}

/**
 * x / 2^k, rounded toward zero. An arithmetic shift alone rounds toward minus
 * infinity, so 2^k-1 is added first when x is negative: the sign mask (0 or -1)
 * ANDed with 2^k-1.
 *
 * Getting the mask is the difference between the two ranges. If x is a
 * sign-extended word, its high word is already 0 or -1, so SWAP and EXT.L give
 * the mask. For any 32-bit x, adding x to itself puts its sign in X, and
 * SUBX of a register from itself turns X into 0 or -1.
 */
function divsPowerOfTwo(k, wide) {
  const mask = 2 ** k - 1;
  const signMask = wide
    ? ["move.l d0,d1", "add.l d1,d1", "subx.l d1,d1"]
    : ["move.l d0,d1", "swap d1", "ext.l d1"];
  const bias = [[`and.l #${mask},d1`]];
  if (k === 1) bias.push(["neg.l d1"]);
  const shifts = [
    k <= 8 ? [`asr.l #${k},d0`] : ["asr.l #8,d0", `asr.l #${k - 8},d0`],
  ];
  let best;
  for (const b of bias)
    for (const sh of shifts) {
      const code = [...signMask, ...b, "add.l d1,d0", ...sh];
      const c = total(code);
      if (
        !best ||
        c.cycles < best.cycles ||
        (c.cycles === best.cycles && c.bytes < best.bytes)
      )
        best = { ...c, code };
    }
  const run = compile(best.code);
  const dividends = wide
    ? powerOfTwoSamples(k)
    : Array.from({ length: 65536 }, (_, i) => i - 32768);
  for (const x of dividends)
    for (const x0 of [0, 1])
      if (run(x >>> 0, x0) !== truncate(x, 2 ** k) >>> 0)
        throw new Error(
          `not exact for ${x} / ${2 ** k}: ${best.code.join(" ; ")}`,
        );
  return {
    bits: wide ? 31 : 15,
    cycles: best.cycles,
    bytes: best.bytes,
    scratch: true,
    code: best.code,
  };
}

function powerOfTwoOptions(k) {
  const options = [divsPowerOfTwo(k, false), divsPowerOfTwo(k, true)];
  return options.filter((o, i) =>
    options.slice(i + 1).every((later) => o.cycles < later.cycles),
  );
}

export async function generate() {
  const candidates = JSON.parse(readFileSync(CANDIDATES, "utf8"));
  const rows = [];
  for (let d = 3; d <= MAX_DIVISOR; d++) {
    if ((d & (d - 1)) === 0) continue;
    const options = recipesFor(d, candidates);
    if (!options.length) continue;
    const entries = options.map(
      (o) =>
        `{ bits: ${o.bits}, cycles: ${o.cycles}, scratch: ${o.scratch}, code: ${JSON.stringify(o.code.map(template).join("\n"))} }`,
    );
    rows.push(`  ${d}: [${entries.join(", ")}],`);
  }
  const signedRows = [];
  for (let d = 3; d <= MAX_DIVISOR; d++) {
    if ((d & (d - 1)) === 0) continue;
    const options = signedRecipesFor(d);
    if (!options.length) continue;
    const entries = options.map(
      (o) =>
        `{ bits: ${o.bits}, cycles: ${o.cycles}, scratch: ${o.scratch}, code: ${JSON.stringify(o.code.map(template).join("\n"))} }`,
    );
    signedRows.push(`  ${d}: [${entries.join(", ")}],`);
  }
  const powerRows = [];
  for (let k = 1; k <= MAX_SIGNED_POWER; k++) {
    const entries = powerOfTwoOptions(k).map(
      (o) =>
        `{ bits: ${o.bits}, cycles: ${o.cycles}, scratch: ${o.scratch}, code: ${JSON.stringify(o.code.map(template).join("\n"))} }`,
    );
    powerRows.push(`  ${2 ** k}: [${entries.join(", ")}],`);
  }
  const source = `// Generated by scripts/generate-divide-recipes.mjs. Do not edit: run
// \`pnpm run generate:divide\` after changing 68kcounter's timings.

/**
 * A way to divide by a constant. It is exact for every dividend below
 * 2^\`bits\`, and leaves the quotient in the low word of \`%d\` (the upper word
 * is not defined). \`%s\` is a scratch register, whole if \`scratch\` is set.
 * \`cycles\` is the 68000 total from 68kcounter.
 */
export interface DivideRecipe {
  readonly bits: number;
  readonly cycles: number;
  readonly scratch: boolean;
  readonly code: string;
}

/**
 * Recipes for \`divu.w #n,Dm\` where only the quotient is used, by divisor.
 * Each list is ordered from the smallest dividend range to the largest, and a
 * recipe appears only if it is cheaper than every one that covers a larger
 * range. Divisors that are powers of two, and divisors above ${MAX_DIVISOR}, are
 * not here.
 */
export const divideRecipes: Readonly<Record<number, readonly DivideRecipe[]>> = {
${rows.join("\n")}
};

/**
 * Recipes for \`divs.w #n,Dm\` where only the quotient is used, by divisor. The
 * same shape as \`divideRecipes\`, but \`bits\` describes a signed dividend:
 * each recipe is exact for every dividend from -2^\`bits\` up to 2^\`bits\` - 1,
 * rounding toward zero as DIVS.W does. \`%s\` is a scratch register whose low
 * word is used.
 */
export const divsRecipes: Readonly<Record<number, readonly DivideRecipe[]>> = {
${signedRows.join("\n")}
};

/**
 * Signed divides by a power of two that round toward zero, by divisor. A plain
 * arithmetic shift rounds toward minus infinity, so a negative dividend gets
 * 2^k-1 added first. \`bits\` is 15 for a dividend that is a sign-extended
 * word, which is cheaper, and 31 for any 32-bit dividend. Each recipe needs a
 * scratch register that is dead in full.
 */
export const divsPowerOfTwoRecipes: Readonly<Record<number, readonly DivideRecipe[]>> = {
${powerRows.join("\n")}
};
`;
  const options = (await prettier.resolveConfig(OUT)) ?? {};
  return prettier.format(source, { ...options, filepath: OUT });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, await generate());
  console.log(`Wrote ${OUT}`);
}

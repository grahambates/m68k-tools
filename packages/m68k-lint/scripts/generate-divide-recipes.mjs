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
 * Run with `pnpm run generate:divide` after building 68kcounter.
 */
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import * as prettier from "prettier";
import { line, mulu, total } from "./divide-common.mjs";

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

/** Compile a recipe into a function of (dividend, initial X) giving d0. */
function compile(code) {
  const steps = code.map((text) => {
    const [mnemonic, rest] = text.split(/\s+/);
    const [name, size] = mnemonic.split(".");
    const operands = rest.split(",");
    const reg = (r) => (r === "d1" ? "d1" : "d0");
    if (name === "mulu")
      return (s) => {
        s.d0 = ((s.d0 & 0xffff) * Number(operands[0].slice(1))) >>> 0;
      };
    if (name === "swap")
      return (s) => {
        s.d0 = ((s.d0 << 16) | (s.d0 >>> 16)) >>> 0;
      };
    if (name === "lsr") {
      const k = Number(operands[0].slice(1));
      const dst = reg(operands[1]);
      const mask = size === "w" ? 0xffff : 0xffffffff;
      return (s) => {
        const low = s[dst] & mask;
        s.x = (low >>> (k - 1)) & 1;
        s[dst] =
          size === "w"
            ? ((s[dst] & 0xffff0000) | (low >>> k)) >>> 0
            : low >>> k;
      };
    }
    if (name === "move") {
      const [src, dst] = operands.map(reg);
      return (s) => {
        s[dst] = s[src];
      };
    }
    if (["add", "addx", "sub", "subx"].includes(name)) {
      const [src, dst] = operands.map(reg);
      const subtract = name.startsWith("sub");
      const extend = name.endsWith("x");
      return (s) => {
        const carryIn = extend ? s.x : 0;
        const r = subtract
          ? s[dst] - s[src] - carryIn
          : s[dst] + s[src] + carryIn;
        s.x = subtract ? (r < 0 ? 1 : 0) : r > 0xffffffff ? 1 : 0;
        s[dst] = r >>> 0;
      };
    }
    throw new Error(`cannot run ${text}`);
  });
  return (x, x0) => {
    const s = { d0: x, d1: 0xdeadbeef, x: x0 };
    for (const step of steps) step(s);
    return s.d0;
  };
}

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
`;
  const options = (await prettier.resolveConfig(OUT)) ?? {};
  return prettier.format(source, { ...options, filepath: OUT });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, await generate());
  console.log(`Wrote ${OUT}`);
}

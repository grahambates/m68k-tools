#!/usr/bin/env node
/**
 * Generates `src/rules/optimization/generated/multiply-recipes.ts`: the cheapest
 * shift/add sequence for multiplying a data register by each constant, for the
 * rules that replace MULS.W and MULU.W.
 *
 * Every operation used is linear in the input, so a sequence is described by
 * the coefficient of x in each of the two registers it may use (the multiplied
 * register and one scratch). A cost-bounded Dijkstra over those coefficient
 * states then gives the cheapest sequence for every constant in one pass, with
 * each instruction costed by 68kcounter (68000) and ties broken by size.
 *
 * Constants are 2 to 256, and for MULS.W their negatives, since a negative
 * constant is only a different coefficient for the same search. (MULU.W reads
 * its constant as unsigned, so a negative one is a large positive.)
 *
 * Two kinds of sequence are produced:
 *
 * - Full result: the 32-bit product of the sign-extended low word, exactly what
 *   MULS.W leaves in the register. It starts with EXT.L and needs a scratch
 *   register that is dead in full.
 * - Low word: the correct low 16 bits, with the upper word left unspecified.
 *   MULS.W and MULU.W agree there. It uses word operations only, so it needs
 *   just the low word of the scratch register, and the multiplied register's
 *   upper word must be unobserved.
 *
 * Run with `pnpm run generate:multiply` after building 68kcounter. A test
 * regenerates the file and compares it, so it cannot go stale when 68kcounter's
 * tables change.
 */
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import parse from "68kcounter";
import * as prettier from "prettier";

const OUT = fileURLToPath(
  new URL(
    "../src/rules/optimization/generated/multiply-recipes.ts",
    import.meta.url,
  ),
);

/** Constants 2..MAX_CONSTANT are considered. */
export const MAX_CONSTANT = 256;
/**
 * Constants MULS.W already has a hand-written rule for (ASP68K's), on every
 * processor. The full-result table leaves them to it, so the two rules never
 * offer the same rewrite.
 */
const ASP68K_FULL_RESULT = new Set([2, 3, 5, 6, 7, 9, 10, 12]);
/** Largest coefficient a search state may hold; anything larger is useless for these constants. */
const COEFFICIENT_BOUND = 600;
/** The search stops at this many cycles. Recipes that cost more than the multiply are never wanted. */
const CYCLE_CAP = { full: 76, low: 56 };

const isPowerOfTwo = (n) => (n & (n - 1)) === 0;

function line(text) {
  const lines = parse(`\t${text}\n`, { cpu: "68000" });
  const l = lines.find((x) => x.statement?.opcode);
  const values = l?.timing?.values;
  if (!values || values.length !== 1)
    throw new Error(`68kcounter has no exact cost for ${text}`);
  return { cycles: values[0][0], bytes: l.bytes };
}

/** The operations, over the multiplied register (d0) and one scratch (d1). */
function operations(size) {
  const add = (a, b) => `add.${size} d${a},d${b}`;
  const sub = (a, b) => `sub.${size} d${a},d${b}`;
  const ops = [
    { t: `move.${size} d0,d1`, f: (s) => ({ a0: s.a0, a1: s.a0, d: 1 }) },
    {
      t: `move.${size} d1,d0`,
      needs1: true,
      f: (s) => ({ a0: s.a1, a1: s.a1, d: 1 }),
    },
    { t: add(0, 0), f: (s) => ({ ...s, a0: s.a0 * 2 }) },
    { t: add(1, 1), needs1: true, f: (s) => ({ ...s, a1: s.a1 * 2 }) },
    { t: add(0, 1), needs1: true, f: (s) => ({ ...s, a1: s.a1 + s.a0 }) },
    { t: add(1, 0), needs1: true, f: (s) => ({ ...s, a0: s.a0 + s.a1 }) },
    { t: sub(0, 1), needs1: true, f: (s) => ({ ...s, a1: s.a1 - s.a0 }) },
    { t: sub(1, 0), needs1: true, f: (s) => ({ ...s, a0: s.a0 - s.a1 }) },
    { t: `neg.${size} d0`, f: (s) => ({ ...s, a0: -s.a0 }) },
    { t: `neg.${size} d1`, needs1: true, f: (s) => ({ ...s, a1: -s.a1 }) },
  ];
  // EXG swaps whole registers. The word sequences may only disturb the low word
  // of the scratch, so they cannot use it.
  if (size === "l")
    ops.push({
      t: "exg d0,d1",
      needs1: true,
      f: (s) => ({ a0: s.a1, a1: s.a0, d: 1 }),
    });
  for (let k = 2; k <= 8; k++) {
    ops.push({
      t: `lsl.${size} #${k},d0`,
      f: (s) => ({ ...s, a0: s.a0 * 2 ** k }),
    });
    ops.push({
      t: `lsl.${size} #${k},d1`,
      needs1: true,
      f: (s) => ({ ...s, a1: s.a1 * 2 ** k }),
    });
  }
  for (const op of ops) Object.assign(op, line(op.t));
  return ops;
}

/** Cheapest way to get each coefficient into d0. Cost is cycles first, then bytes. */
function search(kind) {
  const size = kind === "full" ? "l" : "w";
  const ops = operations(size);
  const start = kind === "full" ? line("ext.l d0") : { cycles: 0, bytes: 0 };
  const weight = (c) => c.cycles * 100 + c.bytes;
  const cap = CYCLE_CAP[kind] * 100 + 99;

  const key = (s) => `${s.a0},${s.d ? s.a1 : "-"}`;
  const best = new Map();
  const parent = new Map();
  const buckets = new Map();
  const push = (w, s) => {
    if (!buckets.has(w)) buckets.set(w, []);
    buckets.get(w).push(s);
  };
  const first = { a0: 1, a1: 0, d: 0 };
  best.set(key(first), weight(start));
  push(weight(start), first);

  for (let w = weight(start); w <= cap; w++) {
    for (const s of buckets.get(w) ?? []) {
      if (best.get(key(s)) !== w) continue;
      for (const op of ops) {
        if (op.needs1 && !s.d) continue;
        const nw = w + op.cycles * 100 + op.bytes;
        if (nw > cap) continue;
        const r = op.f(s);
        if (
          Math.abs(r.a0) > COEFFICIENT_BOUND ||
          Math.abs(r.a1) > COEFFICIENT_BOUND
        )
          continue;
        const k = key(r);
        const old = best.get(k);
        if (old === undefined || nw < old) {
          best.set(k, nw);
          parent.set(`${k}@${nw}`, [key(s), w, op.t]);
          push(nw, r);
        }
      }
    }
  }

  const byCoefficient = new Map();
  for (const [k, w] of best) {
    const a0 = Number(k.split(",")[0]);
    const seen = byCoefficient.get(a0);
    if (!seen || w < seen.w) byCoefficient.set(a0, { w, k });
  }
  return (coefficient) => {
    const hit = byCoefficient.get(coefficient);
    if (!hit) return undefined;
    const steps = [];
    let [k, w] = [hit.k, hit.w];
    while (parent.has(`${k}@${w}`)) {
      const [pk, pw, text] = parent.get(`${k}@${w}`);
      steps.push(text);
      [k, w] = [pk, pw];
    }
    steps.reverse();
    return kind === "full" ? ["ext.l d0", ...steps] : steps;
  };
}

/** Template form: d0 is the multiplied register, d1 the scratch. */
const template = (text) =>
  text.replace(/\bd0\b/g, "%d").replace(/\bd1\b/g, "%s");

function costOf(lines) {
  return lines.reduce(
    (t, text) => {
      const c = line(text);
      return { cycles: t.cycles + c.cycles, bytes: t.bytes + c.bytes };
    },
    { cycles: 0, bytes: 0 },
  );
}

/** The constants 2..MAX_CONSTANT, and for a signed multiply their negatives too. */
const constants = (negative) => [
  ...(negative
    ? Array.from({ length: MAX_CONSTANT - 1 }, (_, i) => -MAX_CONSTANT + i)
    : []),
  ...Array.from({ length: MAX_CONSTANT - 1 }, (_, i) => i + 2),
];

function table(name, doc, kind, multiply, include, negative) {
  const find = search(kind);
  const rows = [];
  for (const c of constants(negative)) {
    if (!include(c)) continue;
    const lines = find(c);
    if (!lines) continue;
    const cost = costOf(lines);
    if (cost.cycles >= line(`${multiply} #${c},d0`).cycles) continue;
    rows.push(
      `  ${c < 0 ? `"${c}"` : c}: { cycles: ${cost.cycles}, scratch: ${lines.some((x) => /d1/.test(x))}, code: ${JSON.stringify(lines.map(template).join("\n"))} },`,
    );
  }
  return `/**\n${doc}\n */\nexport const ${name}: Readonly<Record<number, MultiplyRecipe>> = {\n${rows.join("\n")}\n};\n`;
}

export async function generate() {
  const source = `// Generated by scripts/generate-multiply-recipes.mjs. Do not edit: run
// \`pnpm run generate:multiply\` after changing 68kcounter's timings.

/**
 * A multiply written as shifts and adds. \`%d\` is the multiplied register and
 * \`%s\` a scratch register; \`scratch\` says whether the sequence uses one.
 * \`cycles\` is the 68000 total from 68kcounter. \`code\` is one instruction
 * per line.
 */
export interface MultiplyRecipe {
  readonly cycles: number;
  readonly scratch: boolean;
  readonly code: string;
}

${table(
  "mulsWordFullResultRecipes",
  ` * MULS.W #n,Dm with the full 32-bit result. Starts with EXT.L, and needs a
 * scratch register that is dead in full. Positive constants that ASP68K's rules
 * handle (${[...ASP68K_FULL_RESULT].join(", ")}) and powers of two are left to those. Negative
 * constants are all here, including negative powers of two, which nothing else
 * covers; -1 is left to negative-signed-multiply.`,
  "full",
  "muls.w",
  (c) => c < 0 || (!ASP68K_FULL_RESULT.has(c) && !isPowerOfTwo(c)),
  true,
)}
${table(
  "mulsWordLowWordRecipes",
  ` * MULS.W #n,Dm when only the low word of the result is used, for positive and
 * negative n. Word operations only: the multiplied register's upper word must be
 * unobserved, and only the low word of the scratch register is used.`,
  "low",
  "muls.w",
  () => true,
  true,
)}
${table(
  "muluWordLowWordRecipes",
  ` * MULU.W #n,Dm when only the low word of the result is used. The same
 * sequences as MULS.W, kept apart because the two multiplies cost differently
 * and so beat different constants.`,
  "low",
  "mulu.w",
  () => true,
  false,
)}`;
  const options = (await prettier.resolveConfig(OUT)) ?? {};
  return prettier.format(source, { ...options, filepath: OUT });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, await generate());
  console.log(`Wrote ${OUT}`);
}

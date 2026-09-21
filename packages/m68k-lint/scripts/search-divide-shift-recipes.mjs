#!/usr/bin/env node
/**
 * Offline search for shift/add sequences that divide by a constant.
 *
 * MULU.W by a reciprocal is the better way to divide most dividends, but for a
 * small dividend a few shifts and adds beat it, and the best sequence is
 * different for every divisor. This finds them by searching, over every
 * dividend below 2^R and both starting values of the X flag, for the cheapest
 * sequence of MOVE, LSR, ADD, ADDX, SUB and SUBX on two registers that leaves
 * the exact quotient in d0.
 *
 * The search is slow (seconds per divisor and range), so it is not part of the
 * build. Its results are committed in `divide-shift-candidates.json`;
 * `generate-divide-recipes.mjs` re-verifies and re-costs every one of them, so
 * a stale or wrong entry cannot reach the generated table.
 *
 * Run with `pnpm run search:divide`. It only needs re-running to look for more
 * recipes (a wider divisor or range), not when 68kcounter's timings change.
 */
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import parse from "68kcounter";
import { mulu } from "./divide-common.mjs";

const OUT = fileURLToPath(
  new URL("./divide-shift-candidates.json", import.meta.url),
);

/** Ranges searched, as bits: dividends below 2^R. Above this MULU.W wins. */
const RANGES = [4, 5, 6];
const MAX_DIVISOR = 40;
const U32 = 0xffffffff;

function cost(text) {
  const l = parse(`\t${text}\n`, { cpu: "68000" }).find(
    (x) => x.statement?.opcode,
  );
  return l.timing.values[0][0];
}

/** Operations on d0 and d1 and the X flag, with the 68000's carry rules. */
const OPS = [];
const op = (t, needs1, f) => OPS.push({ t, needs1, c: cost(t), f });
op("move.l d0,d1", false, (s) => {
  s.d1 = s.d0;
  s.def = 1;
});
op("move.l d1,d0", true, (s) => {
  s.d0 = s.d1;
});
for (let k = 1; k <= 8; k++) {
  op(`lsr.l #${k},d0`, false, (s) => {
    s.x = (s.d0 >>> (k - 1)) & 1;
    s.d0 = s.d0 >>> k;
  });
  op(`lsr.l #${k},d1`, true, (s) => {
    s.x = (s.d1 >>> (k - 1)) & 1;
    s.d1 = s.d1 >>> k;
  });
}
const arith = (name, src, dst, subtract, extend) =>
  op(`${name}.l d${src},d${dst}`, src === 1 || dst === 1, (s) => {
    const a = src ? s.d1 : s.d0;
    const b = dst ? s.d1 : s.d0;
    const carryIn = extend ? s.x : 0;
    const r = subtract ? b - a - carryIn : b + a + carryIn;
    const carry = subtract ? (r < 0 ? 1 : 0) : r > U32 ? 1 : 0;
    if (dst) s.d1 = r >>> 0;
    else s.d0 = r >>> 0;
    s.x = carry;
  });
arith("add", 1, 0, false, false);
arith("add", 0, 1, false, false);
arith("add", 0, 0, false, false);
arith("add", 1, 1, false, false);
arith("addx", 1, 0, false, true);
arith("addx", 0, 1, false, true);
arith("addx", 0, 0, false, true);
arith("sub", 1, 0, true, false);
arith("sub", 0, 1, true, false);
arith("subx", 1, 0, true, true);
arith("subx", 0, 1, true, true);

function search(d, R, cap) {
  // Every dividend, each with X clear and set: a recipe must not depend on the caller's X.
  const cases = [];
  for (let x = 0; x < 2 ** R; x++) for (const x0 of [0, 1]) cases.push([x, x0]);
  const goal = cases.map(([x]) => Math.floor(x / d));
  const key = (s) =>
    `${s.def}|${s.d0.join(",")}|${s.def ? s.d1.join(",") : ""}|${s.x.join("")}`;
  const start = {
    d0: cases.map(([x]) => x),
    d1: cases.map(() => 0),
    x: cases.map(([, x0]) => x0),
    def: 0,
  };
  const seen = new Map([[key(start), 0]]);
  const buckets = new Map([[0, [{ s: start, path: [] }]]]);
  for (let c = 0; c <= cap; c++) {
    for (const node of buckets.get(c) ?? []) {
      if (seen.get(key(node.s)) !== c) continue;
      if (node.path.length && node.s.d0.every((v, i) => v === goal[i]))
        return { cycles: c, code: node.path };
      for (const o of OPS) {
        if (o.needs1 && !node.s.def) continue;
        const nc = c + o.c;
        if (nc > cap) continue;
        const next = { d0: [], d1: [], x: [], def: node.s.def };
        for (let i = 0; i < cases.length; i++) {
          const st = {
            d0: node.s.d0[i],
            d1: node.s.d1[i],
            x: node.s.x[i],
            def: node.s.def,
          };
          o.f(st);
          next.d0.push(st.d0);
          next.d1.push(st.d1);
          next.x.push(st.x);
          next.def = st.def;
        }
        const k = key(next);
        const old = seen.get(k);
        if (old === undefined || nc < old) {
          seen.set(k, nc);
          if (!buckets.has(nc)) buckets.set(nc, []);
          buckets.get(nc).push({ s: next, path: [...node.path, o.t] });
        }
      }
    }
  }
  return undefined;
}

const found = [];
for (const R of RANGES) {
  for (let d = 3; d <= MAX_DIVISOR; d++) {
    // Powers of two are a shift, and a divisor above the range gives zero.
    if ((d & (d - 1)) === 0 || d >= 2 ** R) continue;
    // Only worth keeping if it beats the MULU.W recipe for the same range.
    const beat = mulu(d, R)?.cycles;
    const r = search(d, R, (beat ?? 96) - 1);
    if (r) {
      found.push({ divisor: d, bits: R, cycles: r.cycles, code: r.code });
      console.log(
        `R=${R} d=${d}: ${r.cycles}c (mulu ${beat}c) ${r.code.join(" ; ")}`,
      );
    }
  }
}
writeFileSync(OUT, `${JSON.stringify(found, null, 2)}\n`);
console.log(`Wrote ${found.length} candidates to ${OUT}`);

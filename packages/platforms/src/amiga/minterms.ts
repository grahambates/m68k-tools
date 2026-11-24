/**
 * The blitter's logic function: BLTCON0's LF byte, from the Hardware
 * Reference Manual's chapter 6 ("Function Generator"). Bit n of the byte is
 * the destination bit for the combination of sources where A, B and C are
 * bits 2, 1 and 0 of n: bit 7 is ABC, bit 0 is ¬A¬B¬C.
 */

type Literal = 0 | 1 | undefined;

/** A product of sources, each required set (1), clear (0) or either. */
type Term = readonly [a: Literal, b: Literal, c: Literal];

const sources = ["A", "B", "C"] as const;

/** Every product of the three sources, including the empty one, 1. */
const terms: Term[] = (() => {
  const values: Literal[] = [1, 0, undefined];
  const all: Term[] = [];
  for (const a of values)
    for (const b of values) for (const c of values) all.push([a, b, c]);
  return all;
})();

/** The minterms a product covers, as a byte with a bit for each. */
const covers = (term: Term) => {
  let mask = 0;
  for (let n = 0; n < 8; n++) {
    const bits = [(n >> 2) & 1, (n >> 1) & 1, n & 1];
    if (term.every((want, i) => want === undefined || want === bits[i]))
      mask |= 1 << n;
  }
  return mask;
};

const literals = (term: Term) => term.filter((t) => t !== undefined).length;

const termText = (term: Term) =>
  term
    .map((want, i) =>
      want === undefined ? "" : want === 1 ? sources[i] : `¬${sources[i]}`,
    )
    .join("") || "1";

/** The usual names for some functions, from the manual and common use. */
const names: Readonly<Record<number, string>> = {
  0x00: "clear",
  0xff: "set",
  0xf0: "copy A",
  0xcc: "copy B",
  0xaa: "copy C",
  0x0f: "invert A",
  0x33: "invert B",
  0x55: "invert C",
  0xca: "cookie-cut",
};

/**
 * A logic function as an equation for D, with as few products as it can be
 * written in, and the fewest sources among those: $CA is AB + ¬AC, the
 * cookie-cut. A product's sources are ANDed, and products ORed.
 */
export function describeMinterm(lf: number): {
  equation: string;
  name?: string;
} {
  const target = lf & 0xff;
  const name = names[target];
  if (target === 0) return { equation: "D = 0", name };

  // Only products that set no bit outside the function can be part of it.
  const candidates = terms
    .filter((term) => (covers(term) & ~target) === 0)
    .sort((a, b) => literals(a) - literals(b));
  let best: Term[] | undefined;
  const search = (
    chosen: Term[],
    start: number,
    covered: number,
    size: number,
  ) => {
    if (covered === target) {
      const cost = (set: Term[]) => set.reduce((n, t) => n + literals(t), 0);
      if (!best || cost(chosen) < cost(best)) best = [...chosen];
      return;
    }
    if (chosen.length === size) return;
    for (let i = start; i < candidates.length; i++) {
      const next = covers(candidates[i]);
      if ((covered | next) === covered) continue;
      chosen.push(candidates[i]);
      search(chosen, i + 1, covered | next, size);
      chosen.pop();
    }
  };
  // The fewest products first; any function of three sources needs at most four.
  for (let size = 1; size <= 4 && !best; size++) search([], 0, 0, size);

  return { equation: `D = ${best!.map(termText).join(" + ")}`, name };
}

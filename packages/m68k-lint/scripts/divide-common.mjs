/**
 * Shared by the divide-recipe scripts: costs from 68kcounter, and the recipe
 * that divides by multiplying with a reciprocal.
 */
import parse from "68kcounter";

const costs = new Map();
/** 68000 cycles and bytes for one instruction, from 68kcounter. */
export function line(text) {
  if (!costs.has(text)) {
    const l = parse(`\t${text}\n`, { cpu: "68000" }).find(
      (x) => x.statement?.opcode,
    );
    const values = l?.timing?.values;
    if (!values || values.length !== 1)
      throw new Error(`68kcounter has no exact cost for ${text}`);
    costs.set(text, { cycles: values[0][0], bytes: l.bytes });
  }
  return costs.get(text);
}

export function total(code) {
  return code.reduce(
    (t, text) => {
      const c = line(text);
      return { cycles: t.cycles + c.cycles, bytes: t.bytes + c.bytes };
    },
    { cycles: 0, bytes: 0 },
  );
}

/** LSR.W takes a count of 1 to 8, so a larger shift is two instructions. */
function shifts(count) {
  if (count === 0) return [];
  if (count <= 8) return [`lsr.w #${count},d0`];
  return ["lsr.w #8,d0", `lsr.w #${count - 8},d0`];
}

/**
 * x / d for every 0 <= x < 2^bits, as `mulu.w #m,d0 ; swap d0 ; lsr.w #s,d0`:
 * the quotient is (x * m) >> (16 + s), left in the low word.
 *
 * For a given shift, the multipliers that are exact are m = ceil(2^(16+s) / d)
 * and a run of larger values, because the error m*d - 2^(16+s) may grow until
 * it reaches the largest dividend that leaves remainder d-1. MULU.W costs two
 * cycles per set bit of the multiplier, so the cheapest exact one is chosen.
 * Returns undefined when no 16-bit multiplier is exact for this range.
 */
export function mulu(d, bits) {
  const xmax = 2 ** bits - 1;
  // The largest dividend with remainder d-1: the worst case for rounding up.
  const worst = xmax - ((((xmax - (d - 1)) % d) + d) % d);
  let best;
  for (let s = 0; s <= 15; s++) {
    const scale = 2 ** (16 + s);
    for (let m = Math.ceil(scale / d); m <= 0xffff; m++) {
      if (worst >= d - 1 && worst * (m * d - scale) >= scale) break;
      const code = [`mulu.w #${m},d0`, "swap d0", ...shifts(s)];
      const c = total(code);
      if (
        !best ||
        c.cycles < best.cycles ||
        (c.cycles === best.cycles && c.bytes < best.bytes)
      )
        best = { ...c, m, s, code };
    }
  }
  return best;
}

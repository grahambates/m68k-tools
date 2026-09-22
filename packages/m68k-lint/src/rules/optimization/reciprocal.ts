/**
 * Dividing by a constant as a multiplication by its reciprocal.
 *
 * The quotient of `x / d` is `(x * m) >> (16 + s)`, with the multiplier
 * `m = ceil(2^(16+s) / d)`: a fixed-point reciprocal at scale 2^(16+s). The
 * 16 costs nothing, because `SWAP` takes the high word of the 32-bit product,
 * and a further `s` is one `LSR.W`. The multiplier is an immediate word, so it
 * has to fit 16 bits (15 for `MULS.W`, whose multiplier is signed).
 *
 * The scale trades range against accuracy. A larger scale keeps more bits of
 * 1/d and so is exact for larger dividends, but it needs the extra shift, and a
 * multiplier that has to fit 16 bits limits how large it can be. Rather than
 * estimate the range a scale is good for, it is found by dividing every
 * dividend: the reciprocal is exact for 0 up to the first one that comes out
 * wrong.
 *
 * The multiplier has to round up. Rounding to nearest or down comes out one
 * short at some dividend that is a multiple of d, or just above, and is wrong
 * from the start (÷3 with 21845 is wrong at 3).
 *
 * The multiplier is `floor(2^(16+s) / d) + 1`, which is the same as the
 * ceiling for a divisor that does not divide the scale. A divisor that is a
 * power of two does, and is a shift, so callers do not ask for it.
 */
export interface Reciprocal {
  /** The multiplier: `ceil(2^(16+shift) / divisor)`. */
  multiplier: number;
  /** The right shift after the SWAP, so the scale is `2^(16+shift)`. */
  shift: number;
  /** Exact for every dividend from `min` up to `max`. `min` is 0 for an unsigned divide. */
  min: number;
  max: number;
}

/**
 * A range narrower than this is not worth offering: a byte is about the least a
 * dividend can plausibly be, and a recipe that only covers a few values is more
 * likely to be a trap than a help.
 */
const MIN_USEFUL_RANGE = 255;

const unsignedCache = new Map<number, readonly Reciprocal[]>();
const signedCache = new Map<number, readonly Reciprocal[]>();

/**
 * The scales at which an unsigned word divide by `divisor` is a `MULU.W` and a
 * `SWAP`, from the smallest shift up, each with the dividends it is exact for.
 *
 * @param divisor 3 to 65535, and not a power of two
 */
export function unsignedReciprocals(divisor: number): readonly Reciprocal[] {
  const cached = unsignedCache.get(divisor);
  if (cached) return cached;
  const found: Reciprocal[] = [];
  for (let shift = 0; shift <= 15; shift++) {
    const scale = 2 ** (16 + shift);
    const multiplier = Math.floor(scale / divisor) + 1;
    // The multiplier only grows with the shift.
    if (multiplier > 0xffff) break;
    let max = 0xffff;
    for (let x = 0; x <= 0xffff; x++) {
      if (Math.floor((x * multiplier) / scale) !== Math.floor(x / divisor)) {
        max = x - 1;
        break;
      }
    }
    if (max >= MIN_USEFUL_RANGE) found.push({ multiplier, shift, min: 0, max });
  }
  unsignedCache.set(divisor, found);
  return found;
}

/**
 * The same for a signed word divide, which rounds toward zero. `MULS.W` and an
 * arithmetic shift round toward minus infinity, so one is added to the quotient
 * of a negative dividend, and the range is checked with that included.
 *
 * @param divisor 3 to 32767, and not a power of two
 */
export function signedReciprocals(divisor: number): readonly Reciprocal[] {
  const cached = signedCache.get(divisor);
  if (cached) return cached;
  const found: Reciprocal[] = [];
  const exact = (x: number, multiplier: number, scale: number) =>
    Math.floor((x * multiplier) / scale) + (x < 0 ? 1 : 0) ===
    Math.trunc(x / divisor);
  for (let shift = 0; shift <= 15; shift++) {
    const scale = 2 ** (16 + shift);
    const multiplier = Math.floor(scale / divisor) + 1;
    if (multiplier > 0x7fff) break;
    let max = 0x7fff;
    for (let x = 0; x <= 0x7fff; x++) {
      if (!exact(x, multiplier, scale)) {
        max = x - 1;
        break;
      }
    }
    let min = -0x8000;
    for (let x = -1; x >= -0x8000; x--) {
      if (!exact(x, multiplier, scale)) {
        min = x + 1;
        break;
      }
    }
    if (Math.min(max, -min) >= MIN_USEFUL_RANGE)
      found.push({ multiplier, shift, min, max });
  }
  signedCache.set(divisor, found);
  return found;
}

/**
 * The scales worth considering: one is not if a smaller shift, which costs less,
 * is exact for as much.
 */
export function undominated(
  candidates: readonly Reciprocal[],
): readonly Reciprocal[] {
  return candidates.filter(
    (c) =>
      !candidates.some(
        (other) =>
          other.shift < c.shift && other.max >= c.max && other.min <= c.min,
      ),
  );
}

/** The widest range, and of those the smallest shift, which is the cheapest. */
export function widest(
  candidates: readonly Reciprocal[],
): Reciprocal | undefined {
  let best: Reciprocal | undefined;
  for (const c of candidates)
    if (!best || c.max - c.min > best.max - best.min) best = c;
  return best;
}

/** An immediate word shift by 1 to 8 places, so more is two instructions. */
export function shiftInstructions(
  mnemonic: "lsr" | "asr" | "lsl" | "asl",
  register: string,
  count: number,
): string[] {
  if (count === 0) return [];
  if (count <= 8) return [`${mnemonic}.w #${count},${register}`];
  return [
    `${mnemonic}.w #8,${register}`,
    `${mnemonic}.w #${count - 8},${register}`,
  ];
}

const ones = (n: number) => n.toString(2).replaceAll("0", "").length;

/**
 * 68000 cycles for `MULU.W #m,Dn ; SWAP Dn ; LSR.W #s,Dn`: MULU is 38 cycles plus
 * two for each set bit of the multiplier, plus four to fetch the immediate.
 * A test checks this against 68kcounter for every multiplier.
 */
export function unsignedCycles(r: Reciprocal): number {
  return 42 + 2 * ones(r.multiplier) + 4 + wordShiftCycles(r.shift);
}

/**
 * 68000 cycles for an immediate word shift/rotate of 0 to 15 places, split into
 * two instructions past 8. The 6+2n cost is the same for LSR, ASR, LSL and ASL,
 * so this covers a plain shift as well as the shift after a reciprocal's SWAP.
 */
export const wordShiftCycles = (shift: number): number =>
  shift === 0 ? 0 : shift <= 8 ? 6 + 2 * shift : 12 + 2 * shift;

/**
 * 68000 cycles for the signed sequence
 * `MOVE.W ; MULS.W #m ; SWAP ; ASR.W #s ; ADD.W ; CLR.W ; ADDX.W`, and a `NEG.W`
 * for a negative divisor.
 *
 * MULS is 38 cycles plus two for each change between adjacent bits of the
 * multiplier, read as 16 bits with a zero after the last, plus four to fetch
 * the immediate. A test checks this against 68kcounter for every multiplier.
 */
export function signedCycles(r: Reciprocal, negated = false): number {
  const padded = r.multiplier << 1;
  const changes = ones((padded ^ (padded >> 1)) & 0xffff);
  return (
    4 +
    (38 + 2 * changes + 4) +
    4 +
    wordShiftCycles(r.shift) +
    4 +
    4 +
    4 +
    (negated ? 4 : 0)
  );
}

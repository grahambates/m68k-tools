/**
 * A small interpreter for the instructions the divide recipes use, with the
 * 68000's rules for sizes and for the X flag. The generator runs every recipe
 * through it before writing it out.
 *
 * Registers are the multiplied register `d0` and one scratch `d1`, held as
 * unsigned 32-bit numbers.
 */
const MASK = { b: 0xff, w: 0xffff, l: 0xffffffff };
const SIGN = { b: 0x80, w: 0x8000, l: 0x80000000 };

/** The low `size` of a register as an unsigned number (a bare `& 0xffffffff` would be signed). */
const low = (value, size) => (value & MASK[size]) >>> 0;

const signed = (value, size) => {
  const v = low(value, size);
  return v & SIGN[size] ? v - (MASK[size] + 1) : v;
};

/** Compile a recipe (one instruction per element) into a function of the starting d0 and X. */
export function compile(code) {
  const steps = code.map((text) => {
    const [mnemonic, rest = ""] = text.split(/\s+/);
    const [name, size = "l"] = mnemonic.split(".");
    const operands = rest.split(",");
    const reg = (r) => (r === "d1" ? "d1" : "d0");
    const immediate = (t) => Number(t.slice(1));
    /** Write a result at the instruction's size, leaving the rest of the register alone. */
    const put = (s, r, v) => {
      s[r] =
        size === "l"
          ? v >>> 0
          : ((s[r] & ~MASK[size]) | (v & MASK[size])) >>> 0;
    };

    switch (name) {
      case "mulu": {
        const [m, dst] = [immediate(operands[0]), reg(operands[1])];
        return (s) => {
          s[dst] = ((s[dst] & 0xffff) * m) >>> 0;
        };
      }
      case "muls": {
        const [m, dst] = [immediate(operands[0]), reg(operands[1])];
        return (s) => {
          s[dst] = (signed(s[dst], "w") * m) >>> 0;
        };
      }
      case "swap": {
        const dst = reg(operands[0]);
        return (s) => {
          s[dst] = ((s[dst] << 16) | (s[dst] >>> 16)) >>> 0;
        };
      }
      case "ext": {
        if (size !== "l") throw new Error(`cannot run ${text}`);
        const dst = reg(operands[0]);
        return (s) => {
          s[dst] = signed(s[dst], "w") >>> 0;
        };
      }
      case "moveq": {
        const [n, dst] = [immediate(operands[0]), reg(operands[1])];
        return (s) => {
          s[dst] = ((n << 24) >> 24) >>> 0;
        };
      }
      case "clr": {
        const dst = reg(operands[0]);
        return (s) => put(s, dst, 0);
      }
      case "move": {
        const [src, dst] = operands.map(reg);
        return (s) => put(s, dst, s[src]);
      }
      case "and": {
        const dst = reg(operands[1]);
        const source = operands[0];
        return (s) =>
          put(
            s,
            dst,
            (s[dst] &
              (source.startsWith("#") ? immediate(source) : s[reg(source)])) >>>
              0,
          );
      }
      case "neg": {
        const dst = reg(operands[0]);
        return (s) => {
          const v = low(s[dst], size);
          s.x = v === 0 ? 0 : 1;
          put(s, dst, (0 - v) >>> 0);
        };
      }
      case "lsr":
      case "asr": {
        const dst = reg(operands[1]);
        const count = operands[0].startsWith("#")
          ? () => immediate(operands[0])
          : (s) => s[reg(operands[0])] & 63;
        return (s) => {
          const k = count(s);
          if (k === 0) return;
          const v = low(s[dst], size);
          const arithmetic = name === "asr";
          const wide = arithmetic ? BigInt(signed(v, size)) : BigInt(v);
          s.x = Number((wide >> BigInt(Math.min(k - 1, 63))) & 1n);
          put(
            s,
            dst,
            Number((wide >> BigInt(Math.min(k, 63))) & BigInt(MASK[size])),
          );
        };
      }
      case "add":
      case "addx":
      case "sub":
      case "subx": {
        const [src, dst] = operands.map(reg);
        const subtract = name.startsWith("sub");
        const extend = name.endsWith("x");
        return (s) => {
          const carryIn = extend ? s.x : 0;
          const a = low(s[src], size);
          const b = low(s[dst], size);
          const r = subtract ? b - a - carryIn : b + a + carryIn;
          s.x = subtract ? (r < 0 ? 1 : 0) : r > MASK[size] ? 1 : 0;
          put(s, dst, r >>> 0);
        };
      }
      default:
        throw new Error(`cannot run ${text}`);
    }
  });
  return (start, x0) => {
    const s = { d0: start >>> 0, d1: 0xdeadbeef, x: x0 };
    for (const step of steps) step(s);
    return s.d0;
  };
}

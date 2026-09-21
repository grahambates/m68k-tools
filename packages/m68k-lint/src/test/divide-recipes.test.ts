import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import parse from "68kcounter";
import { lint } from "./helpers.js";
import { NEGATE_CYCLES } from "../rules/optimization/divs-word-recipes.js";
import {
  divideRecipes,
  divsPowerOfTwoRecipes,
  divsRecipes,
} from "../rules/optimization/generated/divide-recipes.js";

const GENERATED = new URL(
  "../rules/optimization/generated/divide-recipes.ts",
  import.meta.url,
);

test("the generated divide recipes are up to date with the generator and 68kcounter", async () => {
  const script = new URL(
    "../../scripts/generate-divide-recipes.mjs",
    import.meta.url,
  );
  const { generate } = (await import(pathToFileURL(script.pathname).href)) as {
    generate: () => Promise<string>;
  };
  // If this fails, run `pnpm run generate:divide` and commit the result.
  expect(await generate()).toBe(readFileSync(GENERATED, "utf8"));
}, 120_000);

/**
 * An interpreter for the instructions the recipes use, with the 68000's rules
 * for sizes and for the X flag. It is separate from the generator's own check,
 * so a recipe is verified by two implementations.
 */
function run(code: string, start: number, x0: number): bigint {
  const MASK = { b: 0xffn, w: 0xffffn, l: 0xffffffffn } as const;
  type Size = keyof typeof MASK;
  const BITS = { b: 8, w: 16, l: 32 } as const;
  const reg: Record<string, bigint> = {
    d0: BigInt.asUintN(32, BigInt(start)),
    d1: 0x9e3779b9n,
  };
  let x = BigInt(x0);
  const low = (v: bigint, size: Size) => v & MASK[size];
  const signedAt = (v: bigint, size: Size) =>
    BigInt.asIntN(BITS[size], low(v, size));
  const put = (name: string, value: bigint, size: Size) => {
    reg[name] =
      size === "l"
        ? BigInt.asUintN(32, value)
        : (reg[name] & ~MASK[size] & MASK.l) | (value & MASK[size]);
  };

  for (const text of code.split("\n")) {
    const [op, rest = ""] = text.split(/\s+/);
    const [mnemonic, sizeText = "l"] = op.split(".");
    const size = sizeText as Size;
    const operands = rest.split(",");
    const imm = (t: string) => BigInt(t.slice(1));
    if (mnemonic === "mulu") {
      reg[operands[1]] = BigInt.asUintN(
        32,
        low(reg[operands[1]], "w") * imm(operands[0]),
      );
    } else if (mnemonic === "muls") {
      reg[operands[1]] = BigInt.asUintN(
        32,
        signedAt(reg[operands[1]], "w") * imm(operands[0]),
      );
    } else if (mnemonic === "swap") {
      const v = reg[operands[0]];
      reg[operands[0]] = BigInt.asUintN(32, (v << 16n) | (v >> 16n));
    } else if (mnemonic === "ext") {
      reg[operands[0]] = BigInt.asUintN(32, signedAt(reg[operands[0]], "w"));
    } else if (mnemonic === "moveq") {
      reg[operands[1]] = BigInt.asUintN(32, BigInt.asIntN(8, imm(operands[0])));
    } else if (mnemonic === "clr") {
      put(operands[0], 0n, size);
    } else if (mnemonic === "move") {
      put(operands[1], reg[operands[0]], size);
    } else if (mnemonic === "and") {
      const source = operands[0].startsWith("#")
        ? imm(operands[0])
        : reg[operands[0]];
      put(operands[1], reg[operands[1]] & source, size);
    } else if (mnemonic === "neg") {
      const v = low(reg[operands[0]], size);
      x = v === 0n ? 0n : 1n;
      put(operands[0], -v, size);
    } else if (mnemonic === "lsr" || mnemonic === "asr") {
      const count = operands[0].startsWith("#")
        ? imm(operands[0])
        : reg[operands[0]] & 63n;
      const dest = operands[1];
      const v =
        mnemonic === "asr" ? signedAt(reg[dest], size) : low(reg[dest], size);
      if (count > 0n) {
        x = (v >> (count - 1n)) & 1n;
        put(dest, v >> count, size);
      }
    } else {
      const src = low(reg[operands[0]], size);
      const dst = low(reg[operands[1]], size);
      const carry = mnemonic.endsWith("x") ? x : 0n;
      const subtract = mnemonic.startsWith("sub");
      const r = subtract ? dst - src - carry : dst + src + carry;
      x = subtract ? (r < 0n ? 1n : 0n) : r > MASK[size] ? 1n : 0n;
      put(operands[1], r, size);
    }
  }
  return reg.d0;
}

const render = (code: string) =>
  code.replaceAll("%d", "d0").replaceAll("%s", "d1");

/** Dividends worth checking for a divisor: the edges, and around every multiple near them. */
function samples(divisor: number, bits: number): number[] {
  const limit = 2 ** bits;
  const out = new Set<number>([0, 1, limit - 1, limit - 2]);
  for (let k = 1; k * divisor < limit && k <= 400; k++)
    for (const delta of [-1, 0]) out.add(k * divisor + delta);
  for (let k = Math.floor((limit - 1) / divisor); k > 0 && out.size < 900; k--)
    for (const delta of [-1, 0, divisor - 1])
      if (k * divisor + delta < limit) out.add(k * divisor + delta);
  return [...out].filter((v) => v >= 0 && v < limit);
}

describe("every generated divide recipe divides exactly in its range", () => {
  test("gives the quotient for the dividends that matter, whatever X was", () => {
    for (const [divisorKey, list] of Object.entries(divideRecipes)) {
      const d = Number(divisorKey);
      for (const recipe of list) {
        const code = render(recipe.code);
        for (const x of samples(d, recipe.bits))
          for (const x0 of [0, 1]) {
            const d0 = run(code, x, x0);
            // The low word is the quotient; the upper word is not defined.
            const quotient = recipe.code.includes("mulu") ? d0 & 0xffffn : d0;
            expect(
              quotient,
              `${x} / ${d} with ${recipe.code.replaceAll("\n", " ; ")}`,
            ).toBe(BigInt(Math.floor(x / d)));
          }
      }
    }
  });
});

/** Dividends to check for a signed range: the edges, and around every multiple near them. */
function signedSamples(divisor: number, bits: number): number[] {
  const limit = 2 ** bits;
  const out = new Set<number>([
    0,
    1,
    -1,
    limit - 1,
    -limit,
    -limit + 1,
    limit - 2,
  ]);
  for (let k = 1; k * divisor < limit && k <= 300; k++)
    for (const delta of [-1, 0, 1])
      for (const sign of [1, -1]) {
        const x = sign * (k * divisor + delta);
        if (x >= -limit && x < limit) out.add(x);
      }
  let seed = divisor * 7919 + bits;
  for (let i = 0; i < 600; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out.add((seed % (2 * limit)) - limit);
  }
  return [...out];
}

describe("every generated signed divide recipe divides exactly in its range", () => {
  test("the reciprocal recipes give the quotient rounded toward zero", () => {
    for (const [divisorKey, list] of Object.entries(divsRecipes)) {
      const d = Number(divisorKey);
      for (const recipe of list) {
        const code = render(recipe.code);
        for (const x of signedSamples(d, recipe.bits))
          for (const x0 of [0, 1]) {
            const d0 = run(code, x, x0);
            expect(
              d0 & 0xffffn,
              `${x} / ${d} with ${recipe.code.replaceAll("\n", " ; ")}`,
            ).toBe(BigInt(Math.trunc(x / d)) & 0xffffn);
          }
      }
    }
  }, 60_000);

  test("the power-of-two recipes round toward zero, unlike a bare shift", () => {
    for (const [divisorKey, list] of Object.entries(divsPowerOfTwoRecipes)) {
      const p = Number(divisorKey);
      for (const recipe of list) {
        const code = render(recipe.code);
        const range = recipe.bits === 15 ? 32768 : 2 ** 31;
        const dividends = [
          0,
          1,
          -1,
          p - 1,
          -(p - 1),
          p,
          -p,
          p + 1,
          -(p + 1),
          3,
          -3,
          100,
          -100,
          range - 1,
          -range,
          12345,
          -12345,
          32767,
          -32768,
          ...signedSamples(p, Math.min(recipe.bits, 20)),
        ].filter((x) => x >= -range && x < range);
        for (const x of dividends) {
          const d0 = run(code, x, 0);
          expect(
            d0,
            `${x} / ${p} with ${recipe.code.replaceAll("\n", " ; ")}`,
          ).toBe(BigInt.asUintN(32, BigInt(Math.trunc(x / p))));
        }
      }
    }
  });

  test("a negative divisor is the recipe for its magnitude followed by a negation", () => {
    // x / -d is -(x / d) and both truncate toward zero, so this is exact.
    for (const [divisorKey, list] of Object.entries(divsRecipes)) {
      const d = Number(divisorKey);
      for (const recipe of list) {
        const code = render(recipe.code) + "\nneg.w d0";
        for (const x of signedSamples(d, recipe.bits).slice(0, 80)) {
          const d0 = run(code, x, 0);
          expect(
            d0 & 0xffffn,
            `${x} / -${d} with ${recipe.code.replaceAll("\n", " ; ")} then NEG.W`,
          ).toBe(BigInt(Math.trunc(x / -d)) & 0xffffn);
        }
      }
    }
  }, 60_000);

  test("the exact power-of-two recipes give a negative divisor with NEG.L", () => {
    for (const [divisorKey, list] of Object.entries(divsPowerOfTwoRecipes)) {
      const p = Number(divisorKey);
      for (const recipe of list) {
        const code = render(recipe.code) + "\nneg.l d0";
        const range = recipe.bits === 15 ? 32768 : 2 ** 30;
        for (const x of [
          0,
          1,
          -1,
          3,
          -3,
          p - 1,
          -(p - 1),
          p,
          -p,
          12345,
          -12345,
          range - 1,
          -range + 1,
        ]) {
          if (x < -range || x >= range) continue;
          expect(run(code, x, 0), `${x} / -${p}`).toBe(
            BigInt.asUintN(32, BigInt(Math.trunc(x / -p))),
          );
        }
      }
    }
  });

  test("the negation costs what the rules say it does", () => {
    const cost = (text: string) =>
      parse(`\t${text}\n`, { cpu: "68000" })[0].timing?.values?.[0]?.[0];
    expect(cost("neg.w d0")).toBe(NEGATE_CYCLES.w);
    expect(cost("neg.l d0")).toBe(NEGATE_CYCLES.l);
  });

  test("a bare arithmetic shift would be wrong, which is why the correction exists", () => {
    // -3 / 2 is -1 with DIVS.W, but -3 >> 1 is -2.
    expect(Math.trunc(-3 / 2)).toBe(-1);
    expect(-3 >> 1).toBe(-2);
    const recipe = divsPowerOfTwoRecipes[2][0];
    expect(run(render(recipe.code), -3, 0)).toBe(BigInt.asUintN(32, -1n));
  });
});

describe("the table is well formed", () => {
  test("powers of two are not here, they are a shift", () => {
    for (const key of Object.keys(divideRecipes)) {
      const d = Number(key);
      expect(d & (d - 1)).not.toBe(0);
    }
  });

  test("a larger range never costs less than a smaller one", () => {
    for (const list of Object.values(divideRecipes)) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i].bits).toBeGreaterThan(list[i - 1].bits);
        expect(list[i].cycles).toBeGreaterThan(list[i - 1].cycles);
      }
    }
  });

  test("the signed tables are ordered the same way, and beat DIVS.W's worst case", () => {
    for (const table of [divsRecipes, divsPowerOfTwoRecipes])
      for (const list of Object.values(table)) {
        for (let i = 1; i < list.length; i++) {
          expect(list[i].bits).toBeGreaterThan(list[i - 1].bits);
          expect(list[i].cycles).toBeGreaterThan(list[i - 1].cycles);
        }
        for (const recipe of list) expect(recipe.cycles).toBeLessThan(162);
      }
  });

  test("the signed power-of-two table covers 2 to 16384 and nothing else", () => {
    expect(Object.keys(divsPowerOfTwoRecipes).map(Number)).toEqual(
      Array.from({ length: 14 }, (_, i) => 2 ** (i + 1)),
    );
  });

  test("every recipe beats DIVU.W's worst case", () => {
    for (const list of Object.values(divideRecipes))
      for (const recipe of list) expect(recipe.cycles).toBeLessThan(144);
  });

  test("a recipe says it needs a scratch register only if it uses one", () => {
    for (const list of Object.values(divideRecipes))
      for (const recipe of list)
        expect(recipe.scratch).toBe(recipe.code.includes("%s"));
  });
});

const ID = "optimization/divu-word-by-constant";
const diagnostic = (source: string, processors = ["mc68000"]) =>
  lint(source, { processors: processors as never }).find(
    (d) => d.ruleId === ID,
  );

/** The quotient is kept in d2's low word; d0 is then overwritten, so its remainder half and every flag are dead. */
const quotientOnly = (divide: string) =>
  `${divide}\nmove.w d0,d2\nmoveq #0,d0\nrts`;

describe("the rule", () => {
  test("offers a reciprocal multiply when only the quotient is used", () => {
    const d = diagnostic(quotientOnly("divu.w #10,d0"));
    expect(d?.suggestion?.replacement).toBe(
      "\tmulu.w #52429,d0\n\tswap d0\n\tlsr.w #3,d0",
    );
    expect(d?.suggestion?.applicability).toBe("conditional");
  });

  test("states the dividend range it assumes", () => {
    const d = diagnostic(quotientOnly("divu.w #10,d0"));
    expect(d?.message).toContain("below 65536");
    expect(d?.notes?.[0]?.message).toContain("below 65536");
  });

  test("says so when the divisor has no recipe for the whole 16-bit range", () => {
    // 7 needs a 17-bit multiplier over 16 bits, so its widest recipe covers less.
    const d = diagnostic(quotientOnly("divu.w #7,d0"));
    expect(d?.message).toContain("below 4096");
  });

  test("lists cheaper recipes for smaller dividends", () => {
    const d = diagnostic(
      `${quotientOnly("divu.w #5,d0").replace("rts", "moveq #0,d7\nrts")}`,
    );
    expect(d?.notes?.some((n) => /below 16:/.test(n.message))).toBe(true);
  });

  test("leaves out recipes that change X when X is read afterwards", () => {
    // ADDX reads X. The 16-bit recipe for 10 ends in LSR, which sets it.
    const d = diagnostic(
      "divu.w #10,d0\nmove.w d0,d2\nmoveq #0,d0\naddx.w d4,d3\nrts",
    );
    expect(d?.suggestion?.replacement).toBe("\tmulu.w #6554,d0\n\tswap d0");
    expect(d?.message).toContain("below 4096");
  });

  test("warns that X changes when it is not known to be dead", () => {
    const d = diagnostic(quotientOnly("divu.w #10,d0"));
    expect(d?.notes?.some((n) => /change X/.test(n.message))).toBe(true);
  });

  test("treats a bare DIVU as the word divide it is on the 68000", () => {
    expect(
      diagnostic(quotientOnly("divu #10,d0"))?.suggestion?.replacement,
    ).toBe("\tmulu.w #52429,d0\n\tswap d0\n\tlsr.w #3,d0");
  });

  test("is not offered when the remainder is used", () => {
    // SWAP reads the upper word, which is where DIVU.W leaves the remainder.
    expect(
      diagnostic("divu.w #10,d0\nswap d0\nmove.w d0,d2\nmoveq #0,d0\nrts"),
    ).toBeUndefined();
  });

  test("is offered, with lower confidence, when the remainder use is unknown", () => {
    // d0 leaves the routine, so nothing proves its upper word is dropped.
    const d = diagnostic("divu.w #10,d0\nmove.w d0,(a0)+\nrts");
    expect(d?.suggestion?.replacement).toContain("mulu.w #52429,d0");
    expect(d?.suggestion?.applicability).toBe("conditional");
    expect(d?.confidence).toBe("low");
    expect(
      d?.notes?.some((n) => /Check that the remainder/.test(n.message)),
    ).toBe(true);
  });

  test("is more confident when the remainder is provably unused", () => {
    expect(diagnostic(quotientOnly("divu.w #10,d0"))?.confidence).toBe(
      "medium",
    );
  });

  test("is not offered when the flags are read", () => {
    expect(
      diagnostic("divu.w #10,d0\nbeq .zero\nmoveq #0,d0\n.zero:\nrts"),
    ).toBeUndefined();
  });

  test("is not offered for a power of two, which is a shift", () => {
    expect(diagnostic(quotientOnly("divu.w #8,d0"))).toBeUndefined();
  });

  test("is not offered when the dividend is a known constant", () => {
    expect(
      diagnostic(`move.l #1000,d0\n${quotientOnly("divu.w #10,d0")}`),
    ).toBeUndefined();
  });

  test("is not offered for a named divisor", () => {
    expect(diagnostic(quotientOnly("divu.w #DIVISOR,d0"))).toBeUndefined();
  });

  test("is only for the 68000, where DIVU.W is slow", () => {
    expect(
      diagnostic(quotientOnly("divu.w #10,d0"), ["mc68020"]),
    ).toBeUndefined();
  });

  test("does not touch DIVS.W", () => {
    expect(diagnostic(quotientOnly("divs.w #10,d0"))).toBeUndefined();
  });
});

describe("the signed rules", () => {
  const POW = "optimization/divs-word-power-of-two";
  const RECIP = "optimization/divs-word-by-constant";
  const find = (source: string, id: string, processors = ["mc68000"]) =>
    lint(source, { processors: processors as never }).find(
      (d) => d.ruleId === id,
    );
  /** The quotient is kept in d2's low word, d0 is overwritten, and d7 is free as scratch. */
  const withScratch = (divide: string) =>
    `${divide}\nmove.w d0,d2\nmoveq #0,d0\nmoveq #0,d7\nrts`;
  const noScratch = (divide: string) =>
    `${divide}\nmove.w d0,d2\nmoveq #0,d0\nrts`;

  test("a power of two gets an arithmetic shift, saying it rounds differently", () => {
    const d = find(withScratch("divs.w #4,d0"), POW);
    expect(d?.suggestion?.replacement).toBe("\tasr.l #2,d0");
    expect(d?.suggestion?.applicability).toBe("conditional");
    expect(d?.confidence).toBe("medium");
    expect(d?.message).toContain("minus infinity");
    // The first note is the rounding difference, with the example.
    expect(d?.notes?.[0]?.message).toMatch(
      /-3 \/ 2 is -1 with DIVS\.W and -2 with ASR/,
    );
    expect(d?.notes?.[0]?.message).toMatch(
      /non-negative dividend gives exactly the same/,
    );
  });

  test("lists the forms that round toward zero, for when it matters", () => {
    const d = find(withScratch("divs.w #4,d0"), POW);
    const exact =
      d?.notes?.filter((n) =>
        /round toward zero as DIVS\.W does/.test(n.message),
      ) ?? [];
    // One for a sign-extended word, one for any 32-bit dividend.
    expect(exact).toHaveLength(2);
    expect(
      exact.some(
        (n) =>
          /swap/.test(n.message) && /between -32768 and 32767/.test(n.message),
      ),
    ).toBe(true);
    expect(
      exact.some(
        (n) => /subx\.l/.test(n.message) && /and\.l #3,/.test(n.message),
      ),
    ).toBe(true);
    expect(exact.every((n) => /clobbers D7/.test(n.message))).toBe(true);
  });

  test("treats a bare DIVS as the word divide it is", () => {
    expect(find(withScratch("divs #4,d0"), POW)).toBeDefined();
    expect(find(withScratch("divs #10,d0"), RECIP)).toBeDefined();
  });

  test("needs no scratch register, and says the exact form is not available without one", () => {
    const d = find(noScratch("divs.w #4,d0"), POW);
    expect(d?.suggestion?.replacement).toBe("\tasr.l #2,d0");
    expect(d?.confidence).toBe("medium");
    expect(d?.notes?.some((n) => /No register is free/.test(n.message))).toBe(
      true,
    );
    expect(
      d?.notes?.some((n) =>
        /round toward zero as DIVS\.W does/.test(n.message),
      ),
    ).toBe(false);
  });

  test("splits a large shift in two", () => {
    expect(
      find(noScratch("divs.w #1024,d0"), POW)?.suggestion?.replacement,
    ).toBe("\tasr.l #8,d0\n\tasr.l #2,d0");
  });

  test("a reciprocal recipe for another constant, with the sign correction", () => {
    const d = find(withScratch("divs.w #10,d0"), RECIP);
    const code = d?.suggestion?.replacement ?? "";
    expect(code).toContain("muls.w #26215,d0");
    expect(code).toContain("addx.w");
    expect(d?.message).toContain("between -32768 and 32767");
    expect(d?.suggestion?.applicability).toBe("conditional");
    expect(
      d?.notes?.some((n) => /between -2048 and 2047/.test(n.message)),
    ).toBe(true);
  });

  test("the reciprocal rule says it uses only the low word of its scratch register", () => {
    const d = find(noScratch("divs.w #10,d0"), RECIP);
    expect(d?.suggestion?.replacement).toMatch(/d[1-7]/);
    expect(d?.notes?.some((n) => /low word of D[1-7]/.test(n.message))).toBe(
      true,
    );
  });

  test("the reciprocal rule lists a cheaper recipe for a dividend that is never negative", () => {
    const d = find(withScratch("divs.w #10,d0"), RECIP);
    const note = d?.notes?.find((n) =>
      /never negative and below/.test(n.message),
    );
    // The unsigned recipes need no sign correction.
    expect(note?.message).toContain("mulu.w");
    expect(note?.message).not.toContain("addx");
  });

  test.each([POW, RECIP])(
    "%s is not offered when the remainder is used",
    (id) => {
      const divisor = id === POW ? "4" : "10";
      expect(
        find(
          `divs.w #${divisor},d0\nswap d0\nmove.w d0,d2\nmoveq #0,d0\nmoveq #0,d7\nrts`,
          id,
        ),
      ).toBeUndefined();
    },
  );

  test.each([POW, RECIP])(
    "%s is offered, at lower confidence, when the remainder use is unknown",
    (id) => {
      const divisor = id === POW ? "4" : "10";
      const d = find(
        `divs.w #${divisor},d0\nmove.w d0,(a0)+\nmoveq #0,d7\nrts`,
        id,
      );
      expect(d).toBeDefined();
      expect(
        d?.notes?.some((n) => /Check that the remainder/.test(n.message)),
      ).toBe(true);
    },
  );

  test.each([POW, RECIP])(
    "%s is not offered when X is read afterwards",
    (id) => {
      const divisor = id === POW ? "4" : "10";
      // ADDX reads X, and every signed recipe writes it.
      expect(
        find(
          `divs.w #${divisor},d0\nmove.w d0,d2\nmoveq #0,d0\nmoveq #0,d7\naddx.w d4,d3\nrts`,
          id,
        ),
      ).toBeUndefined();
    },
  );

  test.each([POW, RECIP])("%s is not offered when the flags are read", (id) => {
    const divisor = id === POW ? "4" : "10";
    expect(
      find(
        `divs.w #${divisor},d0\nbeq .zero\nmoveq #0,d0\nmoveq #0,d7\n.zero:\nrts`,
        id,
      ),
    ).toBeUndefined();
  });

  test.each([POW, RECIP])("%s is only for the 68000", (id) => {
    const divisor = id === POW ? "4" : "10";
    expect(
      find(withScratch(`divs.w #${divisor},d0`), id, ["mc68020"]),
    ).toBeUndefined();
  });

  test("a negative power of two is a shift and a negation", () => {
    const d = find(withScratch("divs.w #-4,d0"), POW);
    expect(d?.suggestion?.replacement).toBe("\tasr.l #2,d0\n\tneg.l d0");
    expect(d?.message).toContain("plus infinity");
    // One higher after the negation, with the example.
    expect(d?.notes?.[0]?.message).toMatch(
      /-3 \/ -2 is 1 with DIVS\.W and 2 here/,
    );
    expect(d?.notes?.[0]?.message).toMatch(
      /non-negative dividend gives exactly the same/,
    );
  });

  test("the exact forms for a negative power of two end in NEG.L, and cost 6 more", () => {
    const positive = find(withScratch("divs.w #4,d0"), POW);
    const negative = find(withScratch("divs.w #-4,d0"), POW);
    const cycles = (d: typeof positive) =>
      (d?.notes ?? [])
        .filter((n) => /round toward zero/.test(n.message))
        .map((n) => Number(/\((\d+) cycles/.exec(n.message)?.[1]));
    expect(negative?.notes?.some((n) => /neg\.l d0 \(/.test(n.message))).toBe(
      true,
    );
    expect(cycles(negative)).toEqual(cycles(positive).map((c) => c + 6));
  });

  test("dividing by -1 is a negation", () => {
    const d = find(withScratch("divs.w #-1,d0"), POW);
    expect(d?.suggestion?.replacement).toBe("\tneg.w d0");
    expect(d?.notes?.some((n) => /-32768/.test(n.message))).toBe(true);
  });

  test("a negative reciprocal is the recipe for its magnitude, then NEG.W", () => {
    const positive = find(withScratch("divs.w #10,d0"), RECIP);
    const negative = find(withScratch("divs.w #-10,d0"), RECIP);
    expect(negative?.suggestion?.replacement).toBe(
      `${positive?.suggestion?.replacement}\n\tneg.w d0`,
    );
    expect(negative?.message).toContain("#-10");
    const cycles = (d: typeof positive) =>
      (d?.notes ?? [])
        .filter((n) => /^If the dividend is between/.test(n.message))
        .map((n) => Number(/\((\d+) cycles/.exec(n.message)?.[1]));
    expect(cycles(negative)).toEqual(cycles(positive).map((c) => c + 4));
  });

  test("the never-negative alternatives for a negative divisor also end in NEG.W", () => {
    const d = find(withScratch("divs.w #-10,d0"), RECIP);
    const note = d?.notes?.find((n) =>
      /never negative and below/.test(n.message),
    );
    expect(note?.message).toMatch(/neg\.w d0 \(/);
  });

  test("a negative divisor without a recipe is left alone", () => {
    // 32768 is not a divisor DIVS.W can name, and 6 is not a power of two.
    expect(find(withScratch("divs.w #-32768,d0"), POW)).toBeUndefined();
    expect(find(withScratch("divs.w #-6,d0"), POW)).toBeUndefined();
  });

  test("a bare DIVS with a negative divisor is the word form", () => {
    expect(find(withScratch("divs #-4,d0"), POW)).toBeDefined();
    expect(find(withScratch("divs #-10,d0"), RECIP)).toBeDefined();
  });

  test("neither signed rule touches an unsigned divide", () => {
    expect(find(withScratch("divu.w #4,d0"), POW)).toBeUndefined();
    expect(find(withScratch("divu.w #10,d0"), RECIP)).toBeUndefined();
  });

  test("the unsigned rules do not touch a signed divide", () => {
    expect(
      find(withScratch("divs.w #10,d0"), "optimization/divu-word-by-constant"),
    ).toBeUndefined();
  });
});

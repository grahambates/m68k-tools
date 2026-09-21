import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { lint } from "./helpers.js";
import { divideRecipes } from "../rules/optimization/generated/divide-recipes.js";

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
 * for the X flag. It is separate from the generator's own check, so a recipe is
 * verified by two implementations.
 */
function run(code: string, dividend: number, x0: number): bigint {
  const M32 = 0xffffffffn;
  const reg: Record<string, bigint> = {
    d0: BigInt(dividend),
    d1: 0x9e3779b9n,
  };
  let x = BigInt(x0);
  for (const text of code.split("\n")) {
    const [op, rest = ""] = text.split(/\s+/);
    const [mnemonic, size] = op.split(".");
    const operands = rest.split(",");
    const count = () => BigInt(operands[0].slice(1));
    if (mnemonic === "mulu") {
      reg[operands[1]] = ((reg[operands[1]] & 0xffffn) * count()) & M32;
    } else if (mnemonic === "swap") {
      const v = reg[operands[0]];
      reg[operands[0]] = ((v << 16n) | (v >> 16n)) & M32;
    } else if (mnemonic === "lsr") {
      const dest = operands[1];
      const v = reg[dest];
      const width = size === "w" ? 0xffffn : M32;
      x = ((v & width) >> (count() - 1n)) & 1n;
      const shifted = (v & width) >> count();
      reg[dest] = size === "w" ? (v & ~0xffffn & M32) | shifted : shifted & M32;
    } else if (mnemonic === "move") {
      reg[operands[1]] = reg[operands[0]];
    } else {
      const src = reg[operands[0]];
      const dst = reg[operands[1]];
      const carry = mnemonic.endsWith("x") ? x : 0n;
      const subtract = mnemonic.startsWith("sub");
      const r = subtract ? dst - src - carry : dst + src + carry;
      x = subtract ? (r < 0n ? 1n : 0n) : r > M32 ? 1n : 0n;
      reg[operands[1]] = r & M32;
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

  test("is not offered when the remainder is used", () => {
    // SWAP reads the upper word, which is where DIVU.W leaves the remainder.
    expect(
      diagnostic("divu.w #10,d0\nswap d0\nmove.w d0,d2\nmoveq #0,d0\nrts"),
    ).toBeUndefined();
  });

  test("is not offered when the remainder may be used", () => {
    // d0 leaves the routine, so nothing proves its upper word is dropped.
    expect(diagnostic("divu.w #10,d0\nrts")).toBeUndefined();
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

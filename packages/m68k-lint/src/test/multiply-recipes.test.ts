import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { lint } from "./helpers.js";
import {
  mulsWordFullResultRecipes,
  mulsWordLowWordRecipes,
  muluWordLowWordRecipes,
  type MultiplyRecipe,
} from "../rules/optimization/generated/multiply-recipes.js";

const GENERATED = new URL(
  "../rules/optimization/generated/multiply-recipes.ts",
  import.meta.url,
);

test("the generated recipes are up to date with the generator and 68kcounter", async () => {
  const script = new URL(
    "../../scripts/generate-multiply-recipes.mjs",
    import.meta.url,
  );
  const { generate } = (await import(pathToFileURL(script.pathname).href)) as {
    generate: () => Promise<string>;
  };
  // If this fails, run `pnpm run generate:multiply` and commit the result.
  expect(await generate()).toBe(readFileSync(GENERATED, "utf8"));
}, 60_000);

/**
 * A small interpreter for exactly the instructions the generator may emit. It
 * shares nothing with the generator's coefficient search, so it checks the
 * recipes by running them.
 */
function run(
  code: string,
  regs: { d: bigint; s: bigint },
): { d: bigint; s: bigint } {
  const M32 = 0xffffffffn;
  const state = { d: regs.d, s: regs.s };
  const read = (name: string) => (name === "d0" ? state.d : state.s);
  const write = (name: string, value: bigint) => {
    if (name === "d0") state.d = value & M32;
    else state.s = value & M32;
  };
  const mask = (size: string) => (size === "w" ? 0xffffn : M32);
  const merge = (old: bigint, value: bigint, size: string) =>
    size === "w" ? (old & ~0xffffn & M32) | (value & 0xffffn) : value & M32;

  for (const text of code.split("\n")) {
    const [op, rest] = text.split(/\s+/) as [string, string];
    const [mnemonic, size = ""] = op.split(".");
    const operands = rest.split(",");
    if (mnemonic === "ext") {
      const low = state.d & 0xffffn;
      state.d = low & 0x8000n ? (low | 0xffff0000n) & M32 : low;
    } else if (mnemonic === "exg") {
      [state.d, state.s] = [state.s, state.d];
    } else if (mnemonic === "neg") {
      const [dest] = operands;
      const value = (mask(size) + 1n - (read(dest) & mask(size))) & mask(size);
      write(dest, merge(read(dest), value, size));
    } else if (mnemonic === "lsl" || mnemonic === "asl") {
      const count = BigInt(operands[0].slice(1));
      const dest = operands[1];
      write(dest, merge(read(dest), (read(dest) << count) & mask(size), size));
    } else {
      const [src, dest] = operands;
      const a = read(src) & mask(size);
      const b = read(dest) & mask(size);
      const value =
        mnemonic === "move"
          ? a
          : mnemonic === "add"
            ? a + b
            : mnemonic === "sub"
              ? b - a + (mask(size) + 1n)
              : undefined;
      if (value === undefined) throw new Error(`unexpected ${text}`);
      write(dest, merge(read(dest), value & mask(size), size));
    }
  }
  return state;
}

const render = (recipe: MultiplyRecipe) =>
  recipe.code.replaceAll("%d", "d0").replaceAll("%s", "d1");

const inputs: bigint[] = [];
for (const low of [
  0, 1, 2, 3, 0x7f, 0x80, 0xff, 0x100, 0x7fff, 0x8000, 0x8001, 0xfffe, 0xffff,
  0x1234, 0xabcd,
])
  for (const high of [0n, 0xffffn, 0x5a5an])
    inputs.push((high << 16n) | BigInt(low));

const signed16 = (v: bigint) => {
  const low = v & 0xffffn;
  return low & 0x8000n ? low - 0x10000n : low;
};

describe("every generated recipe computes what it claims", () => {
  test("full result: the 32-bit product of the sign-extended low word", () => {
    for (const [key, recipe] of Object.entries(mulsWordFullResultRecipes)) {
      const c = BigInt(key);
      for (const x of inputs) {
        const { d } = run(render(recipe), { d: x, s: 0xdeadbeefn });
        expect(d, `x${key} on ${x.toString(16)}`).toBe(
          (signed16(x) * c) & 0xffffffffn,
        );
      }
    }
  });

  const low: [string, Record<number, MultiplyRecipe>][] = [
    ["MULS.W", mulsWordLowWordRecipes],
    ["MULU.W", muluWordLowWordRecipes],
  ];
  test.each(low)(
    "%s low word: the right low 16 bits, scratch upper word untouched",
    (_name, table) => {
      for (const [key, recipe] of Object.entries(table)) {
        const c = BigInt(key);
        for (const x of inputs) {
          const scratch = 0xcafe1234n;
          const { d, s } = run(render(recipe), { d: x, s: scratch });
          expect(d & 0xffffn, `x${key} on ${x.toString(16)}`).toBe(
            ((x & 0xffffn) * c) & 0xffffn,
          );
          // Only the low word of the scratch register may change.
          expect(s & 0xffff0000n, `x${key} scratch upper word`).toBe(
            scratch & 0xffff0000n,
          );
        }
      }
    },
  );

  test("a recipe that says it needs no scratch never touches one", () => {
    for (const table of [
      mulsWordFullResultRecipes,
      mulsWordLowWordRecipes,
      muluWordLowWordRecipes,
    ])
      for (const recipe of Object.values(table))
        expect(recipe.scratch).toBe(recipe.code.includes("%s"));
  });
});

const ID_FULL = "optimization/muls-word-full-result-constants";
const ID_LOW_S = "optimization/muls-word-low-word-only";
const ID_LOW_U = "optimization/mulu-word-low-word-only";

const suggestion = (source: string, id: string) =>
  lint(source, { processors: ["mc68000"] }).find((d) => d.ruleId === id)
    ?.suggestion?.replacement;

describe("the rules use the generated recipes", () => {
  test("a full-result constant beyond the old hand-written table", () => {
    // 63 was not in the old table; 46 cycles as MULS.W, 36 as shifts and adds.
    const replacement = suggestion("muls.w #63,d0\nmove.l d0,d2\nrts", ID_FULL);
    expect(replacement).toBeDefined();
    expect(replacement).toContain("asl.l #6");
  });

  test("a low-word constant gets a word-only sequence", () => {
    const replacement = suggestion(
      "muls.w #40,d0\nmove.w d0,d2\nmoveq #0,d0\nrts",
      ID_LOW_S,
    );
    expect(replacement).toBeDefined();
    expect(replacement).not.toContain(".l");
  });

  // A power of two is muls/mulu-word-power-of-two's to report; the word-only
  // rules only compute this one for them to attach as a cheaper alternative.
  const alternative = (source: string, id: string, altId: string) =>
    lint(source, { processors: ["mc68000"] })
      .find((d) => d.ruleId === id)
      ?.alternatives?.find((a) => a.ruleId === altId)?.suggestion?.replacement;

  test("a power of two becomes a single word shift when the upper word is dead", () => {
    expect(
      alternative(
        "muls.w #64,d0\nmove.w d0,d2\nmoveq #0,d0\nrts",
        "optimization/muls-word-power-of-two",
        ID_LOW_S,
      ),
    ).toBe("\tasl.w #6,d0");
    expect(
      alternative(
        "mulu.w #64,d0\nmove.w d0,d2\nmoveq #0,d0\nrts",
        "optimization/mulu-word-power-of-two",
        ID_LOW_U,
      ),
    ).toBe("\tlsl.w #6,d0");
  });

  test("MULU.W #1 is still removed outright", () => {
    expect(
      suggestion("mulu.w #1,d0\nmove.w d0,d2\nmoveq #0,d0\nrts", ID_LOW_U),
    ).toBe("");
  });

  test("the full-result rule defers to the word-only rule when it applies", () => {
    const source = "muls.w #15,d0\nmove.w d0,d2\nmoveq #0,d0\nrts";
    expect(suggestion(source, ID_FULL)).toBeUndefined();
    expect(suggestion(source, ID_LOW_S)).toBeDefined();
  });

  test("the full-result rule still applies when the upper word is used", () => {
    expect(
      suggestion("muls.w #15,d0\nmove.l d0,d2\nrts", ID_FULL),
    ).toBeDefined();
  });

  test("no scratch is needed, or claimed, for a recipe that uses none", () => {
    const diagnostic = lint("muls.w #64,d0\nmove.w d0,d2\nmoveq #0,d0\nrts", {
      processors: ["mc68000"],
    })
      .find((d) => d.ruleId === "optimization/muls-word-power-of-two")
      ?.alternatives?.find((a) => a.ruleId === ID_LOW_S);
    expect(diagnostic?.suggestion?.replacement).not.toMatch(/d[1-7]/);
    expect(diagnostic?.notes?.some((n) => /scratch/i.test(n.message))).toBe(
      false,
    );
  });
});

describe("negative constants", () => {
  const id = (rule: string) => `optimization/${rule}`;
  const at = (source: string, rule: string) =>
    lint(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === id(rule),
    );

  test("the tables have a negative half, for MULS.W only", () => {
    const negative = (table: Record<number, unknown>) =>
      Object.keys(table).filter((k) => Number(k) < 0).length;
    expect(negative(mulsWordFullResultRecipes)).toBeGreaterThan(40);
    expect(negative(mulsWordLowWordRecipes)).toBeGreaterThan(200);
    // MULU.W reads its constant as unsigned, so a negative one is not a small multiply.
    expect(negative(muluWordLowWordRecipes)).toBe(0);
  });

  test("-1 is left to negative-signed-multiply", () => {
    for (const table of [mulsWordFullResultRecipes, mulsWordLowWordRecipes])
      expect(table[-1]).toBeUndefined();
  });

  test("a negative full-result constant gets a shift/add sequence", () => {
    const d = at(
      "muls.w #-13,d0\nmove.l d0,d2\nrts",
      "muls-word-full-result-constants",
    );
    expect(d?.message).toContain("MULS.W #-13");
    expect(d?.suggestion?.replacement).toContain("sub.l");
  });

  test("a negative low-word constant gets a word-only sequence", () => {
    const d = at(
      "muls.w #-40,d0\nmove.w d0,d2\nmoveq #0,d0\nrts",
      "muls-word-low-word-only",
    );
    expect(d?.suggestion?.replacement).toBeDefined();
    expect(d?.suggestion?.replacement).not.toContain(".l");
    expect(d?.suggestion?.replacement).toContain("neg.w");
  });

  test("a negative power of two is a negation and a shift", () => {
    expect(
      at(
        "muls.w #-64,d0\nmove.w d0,d2\nmoveq #0,d0\nrts",
        "muls-word-low-word-only",
      )?.suggestion?.replacement,
    ).toBe("\tneg.w d0\n\tasl.w #6,d0");
    expect(
      at("muls.w #-64,d0\nmove.l d0,d2\nrts", "muls-word-full-result-constants")
        ?.suggestion?.replacement,
    ).toBe("\text.l d0\n\tneg.l d0\n\tasl.l #6,d0");
  });

  test("a word pattern above 32767 is the negative it encodes", () => {
    // vasm encodes #$fff5, #65525 and #-11 identically.
    for (const spelling of ["#$fff5", "#65525"]) {
      const d = at(
        `muls.w ${spelling},d0\nmove.l d0,d2\nrts`,
        "muls-word-full-result-constants",
      );
      expect(d?.message).toContain("MULS.W #-11");
    }
  });

  test("MULU.W by a negative-looking constant is not touched", () => {
    expect(
      at(
        "mulu.w #-11,d0\nmove.w d0,d2\nmoveq #0,d0\nrts",
        "mulu-word-low-word-only",
      ),
    ).toBeUndefined();
  });

  test("-1 still only gets the vasm rule", () => {
    const ids = lint("muls.w #-1,d0\nmove.l d0,d2\nrts", {
      processors: ["mc68000"],
    }).map((d) => d.ruleId);
    expect(ids).toContain("optimization/negative-signed-multiply");
    expect(ids).not.toContain("optimization/muls-word-full-result-constants");
  });

  test("a bare MULS with a negative constant is the word form", () => {
    expect(
      at("muls #-13,d0\nmove.l d0,d2\nrts", "muls-word-full-result-constants"),
    ).toBeDefined();
  });
});

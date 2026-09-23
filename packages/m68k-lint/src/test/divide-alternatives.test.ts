import { lint } from "./helpers.js";

/**
 * Three more caveats-as-prose turned into real, selectable alternatives, the
 * same way divu-word-by-constant's smaller scales were: divu's own "made for
 * this value" recipes, divs-word-by-constant's smaller scales, and
 * divs-word-power-of-two's forms that round toward zero exactly instead of
 * the plain (cheaper, but differently-rounding) ASR.
 */
const RTS = "\n\tmoveq #0,d7\n\trts";

describe("divu-word-by-constant offers its made-for-value recipes as alternatives", () => {
  test("a recipe made for the literal value is a real choice, not just a note", () => {
    const source = `\tdivu #10,d0\n\tmove.w d0,d2\n\tmoveq #0,d0${RTS}`;
    const d = lint(source).find(
      (x) => x.ruleId === "optimization/divu-word-by-constant",
    );
    const madeFor = d?.alternatives?.filter((a) =>
      a.suggestion?.description?.startsWith("Made for 10"),
    );
    expect(madeFor?.length).toBeGreaterThan(0);
    // Widest (least clobbering, most range) first.
    expect(madeFor?.[0]?.suggestion?.replacement).toBe(
      "\tmulu.w #6554,d0\n\tswap d0",
    );
    expect(
      madeFor?.every((a) => a.suggestion?.applicability === "conditional"),
    ).toBe(true);
  });

  test("a named divisor gets none: they cannot follow the constant", () => {
    const source = `MY_DIV equ 10\n\tdivu #MY_DIV,d0\n\tmove.w d0,d2\n\tmoveq #0,d0${RTS}`;
    const d = lint(source).find(
      (x) => x.ruleId === "optimization/divu-word-by-constant",
    );
    expect(
      d?.alternatives?.some((a) =>
        a.suggestion?.description?.startsWith("Made for"),
      ),
    ).toBe(false);
  });
});

describe("divs-word-by-constant offers a smaller scale as an alternative", () => {
  test("a cheaper, narrower-range scale is a selectable choice", () => {
    const source = `\tdivs.w #10,d0\n\tmove.w d0,d2\n\tmoveq #0,d0${RTS}`;
    const d = lint(source).find(
      (x) => x.ruleId === "optimization/divs-word-by-constant",
    );
    const smaller = d?.alternatives?.find((a) =>
      a.suggestion?.description?.includes("smaller scale"),
    );
    expect(smaller?.suggestion?.replacement).toBe(
      "\tmove.w d0,d2\n\tmuls.w #$10000/10+1,d0\n\tswap d0\n\tadd.w d2,d2\n\tclr.w d2\n\taddx.w d2,d0",
    );
    expect(smaller?.suggestion?.applicability).toBe("conditional");
  });
});

describe("divs-word-power-of-two offers the exact-rounding forms as alternatives", () => {
  test("rounding toward zero like DIVS.W is a real choice next to the plain shift", () => {
    const source = `\tdivs.w #4,d0\n\tmove.w d0,d2\n\tmoveq #0,d0${RTS}`;
    const d = lint(source).find(
      (x) => x.ruleId === "optimization/divs-word-power-of-two",
    );
    expect(d?.suggestion?.replacement).toBe("\tasr.l #2,d0");
    const exact = d?.alternatives ?? [];
    // One for a sign-extended word, one for any 32-bit dividend.
    expect(exact).toHaveLength(2);
    expect(exact.some((a) => /sign-extended word/.test(a.message))).toBe(true);
    expect(
      exact.some((a) => a.suggestion?.replacement?.includes("and.l #3,d7")),
    ).toBe(true);
    expect(
      exact.every((a) => a.suggestion?.applicability === "conditional"),
    ).toBe(true);
    expect(
      exact.every((a) => a.suggestion?.description?.includes("clobbers D7")),
    ).toBe(true);
  });

  test("a negative divisor's exact forms still end in NEG.L", () => {
    const source = `\tdivs.w #-4,d0\n\tmove.w d0,d2\n\tmoveq #0,d0${RTS}`;
    const d = lint(source).find(
      (x) => x.ruleId === "optimization/divs-word-power-of-two",
    );
    expect(
      d?.alternatives?.every((a) =>
        a.suggestion?.replacement?.endsWith("neg.l d0"),
      ),
    ).toBe(true);
  });

  test("with no scratch register, there is nothing to offer", () => {
    // Every other data register is read afterward (movem.l pushes them all),
    // so none is dead for the exact form to clobber.
    const source =
      "\tdivs.w #4,d0\n\tmove.w d0,d2\n\tmoveq #0,d0\n\tmovem.l d1-d7,-(sp)\n\trts";
    const d = lint(source).find(
      (x) => x.ruleId === "optimization/divs-word-power-of-two",
    );
    expect(d?.alternatives ?? []).toHaveLength(0);
    expect(d?.notes?.some((n) => /No register is free/.test(n.message))).toBe(
      true,
    );
  });
});

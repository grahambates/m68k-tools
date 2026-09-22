import { lint } from "./helpers.js";

/**
 * A word multiply by a power of two only needs its low word extended to a
 * long when the caller actually reads that upper word afterward. When it does
 * not -- the usual case, a scratch multiply immediately narrowed back to a
 * word -- a plain word shift is exact and much cheaper than sign/zero
 * extending first: https://github.com/grahambates (report) "avoid extending
 * to longword if the upper word isn't used".
 */
const RTS = "\n\tmoveq #0,d7\n\trts";

describe("word-only shift preferred over long extension", () => {
  test("MULU.W by a small power of two, low word only, on 68000", () => {
    const source = `Foo: ds.w 1\n\tmulu #8,d0\n\tmove.w d0,Foo\n\trts`;
    const diagnostics = lint(source);
    const low = diagnostics.find(
      (d) => d.ruleId === "optimization/mulu-word-low-word-only",
    );
    expect(low?.suggestion?.replacement).toBe("\tlsl.w #3,d0");
    // The heavier zero-extending form is not offered alongside it.
    expect(diagnostics.map((d) => d.ruleId)).not.toContain(
      "optimization/mulu-word-power-of-two",
    );
  });

  test("MULS.W by a small power of two, low word only, on 68000", () => {
    const source = `\tmuls.w #8,d0\n\tmove.w d0,d2${RTS}`;
    const diagnostics = lint(source);
    const low = diagnostics.find(
      (d) => d.ruleId === "optimization/muls-word-low-word-only",
    );
    expect(low?.suggestion?.replacement).toBe("\tasl.w #3,d0");
    expect(diagnostics.map((d) => d.ruleId)).not.toContain(
      "optimization/muls-word-power-of-two",
    );
  });

  test("a power of two above the generated tables' range still gets a word shift", () => {
    const source = `\tmulu.w #1024,d0\n\tmove.w d0,d2${RTS}`;
    const low = lint(source).find(
      (d) => d.ruleId === "optimization/mulu-word-low-word-only",
    );
    expect(low?.suggestion?.replacement).toBe("\tlsl.w #8,d0\n\tlsl.w #2,d0");
    expect(lint(source).map((d) => d.ruleId)).not.toContain(
      "optimization/mulu-word-high-power-of-two",
    );
  });

  test("the long form still fires when the upper word is read", () => {
    const source = `\tmulu.w #8,d0\n\tmove.l d0,d1${RTS}`;
    const ids = lint(source).map((d) => d.ruleId);
    expect(ids).toContain("optimization/mulu-word-power-of-two");
    expect(ids).not.toContain("optimization/mulu-word-low-word-only");
  });

  test("the word-only form is a lower-confidence review when use is merely unproven, not a hard requirement", () => {
    // Nothing here reads d0 again, but it also is not proven dead (it could,
    // for instance, be this routine's return value past the RTS).
    const source = `\tmulu.w #8,d0${RTS}`;
    const diagnostic = lint(source).find(
      (d) => d.ruleId === "optimization/mulu-word-low-word-only",
    );
    expect(diagnostic?.confidence).toBe("medium");
    expect(diagnostic?.suggestion?.applicability).toBe("conditional");
    expect(diagnostic?.notes?.some((n) => /cannot prove/.test(n.message))).toBe(
      true,
    );
  });

  test("on 68020, where the word-only sibling does not apply, the long form still fires unconditionally", () => {
    const source = `\tmuls.w #8,d0${RTS}`;
    const diagnostic = lint(source, { processors: ["mc68020"] }).find(
      (d) => d.ruleId === "optimization/muls-word-power-of-two",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\text.l d0\n\tasl.l #3,d0",
    );
  });
});

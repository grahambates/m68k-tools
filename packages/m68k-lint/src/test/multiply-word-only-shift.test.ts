import { lint } from "./helpers.js";

/**
 * A word multiply by a power of two only needs its low word extended to a
 * long when the caller actually reads that upper word afterward. When it does
 * not -- the usual case, a scratch multiply immediately narrowed back to a
 * word -- a plain word shift is exact and much cheaper than sign/zero
 * extending first, so it is offered alongside the always-correct extending
 * form as a cheaper, conditional alternative rather than replacing it.
 *
 * mulu/muls-word-low-word-only own this replacement, but do not report a
 * power of two on their own account: mulu/muls-word-power-of-two and their
 * high-power siblings compute it and attach it, so a power of two is never
 * reported by both at once.
 */
const RTS = "\n\tmoveq #0,d7\n\trts";

describe("word-only shift offered as a cheaper alternative", () => {
  test("MULU.W by a small power of two, low word only, on 68000", () => {
    const source = `Foo: ds.w 1\n\tmulu #8,d0\n\tmove.w d0,Foo\n\trts`;
    const diagnostics = lint(source);
    const primary = diagnostics.find(
      (d) => d.ruleId === "optimization/mulu-word-power-of-two",
    );
    expect(primary?.suggestion?.replacement).toBe(
      "\tswap d0\n\tclr.w d0\n\tswap d0\n\tlsl.l #3,d0",
    );
    const alt = primary?.alternatives?.find(
      (a) => a.ruleId === "optimization/mulu-word-low-word-only",
    );
    expect(alt?.suggestion?.replacement).toBe("\tlsl.w #3,d0");
    // Not offered again on its own account: it is nested under the primary.
    expect(diagnostics.map((d) => d.ruleId)).not.toContain(
      "optimization/mulu-word-low-word-only",
    );
  });

  test("MULS.W by a small power of two, low word only, on 68000", () => {
    const source = `\tmuls.w #8,d0\n\tmove.w d0,d2${RTS}`;
    const diagnostics = lint(source);
    const primary = diagnostics.find(
      (d) => d.ruleId === "optimization/muls-word-power-of-two",
    );
    expect(primary?.suggestion?.replacement).toBe("\text.l d0\n\tasl.l #3,d0");
    const alt = primary?.alternatives?.find(
      (a) => a.ruleId === "optimization/muls-word-low-word-only",
    );
    expect(alt?.suggestion?.replacement).toBe("\tasl.w #3,d0");
    expect(diagnostics.map((d) => d.ruleId)).not.toContain(
      "optimization/muls-word-low-word-only",
    );
  });

  test("a power of two above the generated tables' range still gets a word shift", () => {
    const source = `\tmulu.w #1024,d0\n\tmove.w d0,d2${RTS}`;
    const diagnostics = lint(source);
    const primary = diagnostics.find(
      (d) => d.ruleId === "optimization/mulu-word-high-power-of-two",
    );
    const alt = primary?.alternatives?.find(
      (a) => a.ruleId === "optimization/mulu-word-low-word-only",
    );
    expect(alt?.suggestion?.replacement).toBe("\tlsl.w #8,d0\n\tlsl.w #2,d0");
    expect(diagnostics.map((d) => d.ruleId)).not.toContain(
      "optimization/mulu-word-low-word-only",
    );
  });

  test("the long form fires alone when the upper word is read", () => {
    const source = `\tmulu.w #8,d0\n\tmove.l d0,d1${RTS}`;
    const primary = lint(source).find(
      (d) => d.ruleId === "optimization/mulu-word-power-of-two",
    );
    expect(primary).toBeDefined();
    expect(primary?.alternatives ?? []).toHaveLength(0);
    expect(lint(source).map((d) => d.ruleId)).not.toContain(
      "optimization/mulu-word-low-word-only",
    );
  });

  test("the alternative is a lower-confidence review when use is merely unproven, not a hard requirement", () => {
    // Nothing here reads d0 again, but it also is not proven dead (it could,
    // for instance, be this routine's return value past the RTS).
    const source = `\tmulu.w #8,d0${RTS}`;
    const primary = lint(source).find(
      (d) => d.ruleId === "optimization/mulu-word-power-of-two",
    );
    const alt = primary?.alternatives?.find(
      (a) => a.ruleId === "optimization/mulu-word-low-word-only",
    );
    expect(alt?.confidence).toBe("medium");
    expect(alt?.suggestion?.applicability).toBe("conditional");
    expect(alt?.notes?.some((n) => /cannot prove/.test(n.message))).toBe(true);
  });

  test("on 68020, where the word-only alternative does not apply, the long form fires alone", () => {
    const source = `\tmuls.w #8,d0${RTS}`;
    const diagnostic = lint(source, { processors: ["mc68020"] }).find(
      (d) => d.ruleId === "optimization/muls-word-power-of-two",
    );
    expect(diagnostic?.suggestion?.replacement).toBe(
      "\text.l d0\n\tasl.l #3,d0",
    );
    expect(diagnostic?.alternatives ?? []).toHaveLength(0);
  });
});

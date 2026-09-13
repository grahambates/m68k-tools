import { lintSource } from "../core/lint.js";

/**
 * A rule that copies a value through keeps the symbol, so the code still tracks
 * the constant. A rule that *derives* one — a shift count from a multiplier,
 * the sum of two ADDQs — writes the arithmetic result and the name disappears:
 * `muls.w #SCALE,d0` becomes `asl.l #3,d0`, which is silently wrong the moment
 * SCALE changes.
 *
 * That is invisible in a way a longer replacement is not, so it is said out
 * loud rather than left for the reader to notice.
 */
const DEFS = "SCALE equ 8\nSMALL equ 3\nBIG equ 100\n";

const lossNote = (lines: string[], ruleId: string) => {
  const source =
    DEFS + lines.map((l) => `\t${l}`).join("\n") + "\n\tmoveq #0,d7\n\trts";
  const found = lintSource(source, { processors: ["mc68000"] }).find(
    (d) => d.ruleId === ruleId,
  );
  return (found?.notes ?? [])
    .map((n) => n.message)
    .find((m) => /does not appear|do not appear/.test(m));
};

describe("a derived value loses the name behind it", () => {
  test("a multiplier becomes a shift count", () => {
    expect(
      lossNote(["muls.w #SCALE,d0"], "optimization/muls-word-power-of-two"),
    ).toContain("SCALE");
  });

  test("a divisor becomes a shift count", () => {
    expect(
      lossNote(["divu.w #SCALE,d0"], "optimization/divu-word-power-of-two"),
    ).toContain("SCALE");
  });

  // No assembler has a log2 operator, so there is no way to write the shift
  // count in terms of the multiplier it came from.
  test("a multiplier that only survives as a shift count", () => {
    expect(
      lossNote(["muls.w #SCALE,d0"], "optimization/muls-word-power-of-two"),
    ).toContain("SCALE");
  });
});

describe("a value carried through keeps its name, and says nothing", () => {
  test("an immediate passed straight to MOVEQ", () => {
    expect(
      lossNote(["move.l #BIG,d0"], "optimization/prefer-moveq"),
    ).toBeUndefined();
  });

  test("a branch target carried into the tail call", () => {
    expect(
      lossNote(["bsr .sub", "rts"], "optimization/bsr-rts-tail-call"),
    ).toBeUndefined();
  });

  test("a compound displacement kept whole", () => {
    const source = "SCREEN_BW equ 320\n\tadda.w #SCREEN_BW/2,a3\n\trts";
    const found = lintSource(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === "optimization/address-add-to-lea",
    );
    expect(
      (found?.notes ?? [])
        .map((n) => n.message)
        .some((m) => /does not appear/.test(m)),
    ).toBe(false);
  });
});

describe("removal is not loss", () => {
  // Deleting dead code drops every name in it by design.
  test("a deletion says nothing about the names it removes", () => {
    const source =
      "COUNT equ 4\n\tmove.w #COUNT,d0\n\tmove.w #200,d0\n\tmove.l d0,(a0)\n\trts";
    const found = lintSource(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === "suspicious/dead-register-write",
    );
    expect(found?.suggestion?.replacement).toBe("");
    expect(
      (found?.notes ?? [])
        .map((n) => n.message)
        .some((m) => /does not appear/.test(m)),
    ).toBe(false);
  });
});

/**
 * Where the derivation can be written in assembly, writing it keeps the name.
 * A bit mask is `1<<n`, so `bset #SPRITE_ON,d3` need not collapse to a hex
 * constant that no longer mentions SPRITE_ON.
 */
describe("a derivation the assembler can express keeps the symbol", () => {
  const replacement = (instruction: string, ruleId: string) => {
    const source = `SPRITE_ON equ 2\nBASE equ 1\n\t${instruction}\n\tmoveq #0,d7\n\trts`;
    return lintSource(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === ruleId,
    )?.suggestion?.replacement;
  };

  test("a literal bit number is written as a shift, not a hex mask", () => {
    expect(replacement("bset #2,d3", "optimization/bset-low-word-mask")).toBe(
      "\tor.w #1<<2,d3",
    );
  });

  test("a symbolic bit number survives", () => {
    expect(
      replacement("bset #SPRITE_ON,d3", "optimization/bset-low-word-mask"),
    ).toBe("\tor.w #1<<SPRITE_ON,d3");
    expect(
      lossNote(["bset #SPRITE_ON,d3"], "optimization/bset-low-word-mask"),
    ).toBeUndefined();
  });

  // `1<<BASE+1` would depend on the assembler agreeing with C about precedence.
  test("a compound bit number is parenthesised", () => {
    expect(
      replacement("bset #BASE+1,d3", "optimization/bset-low-word-mask"),
    ).toBe("\tor.w #1<<(BASE+1),d3");
  });

  test("a sum is written out when either side is a name", () => {
    const source =
      "SMALL equ 3\n\taddq.l #SMALL,d0\n\taddq.l #2,d0\n\tmoveq #0,d7\n\trts";
    const found = lintSource(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === "optimization/combine-consecutive-addq",
    );
    expect(found?.suggestion?.replacement).toBe("\taddq.l #SMALL+2,d0");
  });

  // `#3+2` keeps nothing and reads worse than `#5`.
  test("two literals are still folded into their total", () => {
    const source = "\taddq.l #3,d0\n\taddq.l #2,d0\n\tmoveq #0,d7\n\trts";
    const found = lintSource(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === "optimization/combine-consecutive-addq",
    );
    expect(found?.suggestion?.replacement).toBe("\taddq.l #5,d0");
  });

  test("an exact halving is written out when the value is named", () => {
    const source = "BYTES equ 200\n\tmove.l #BYTES,d0\n\tmoveq #0,d7\n\trts";
    const found = lintSource(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === "optimization/move-immediate-double-byte",
    );
    expect(found?.suggestion?.replacement).toBe(
      "\tmoveq #BYTES/2,d0\nadd.b d0,d0".replace("\nadd", "\n\tadd"),
    );
  });

  test("BCLR writes the complement of the same shift", () => {
    expect(
      replacement("bclr #SPRITE_ON,d3", "optimization/bclr-low-word-mask"),
    ).toBe("\tand.w #~(1<<SPRITE_ON),d3");
  });
});

import { lintSource } from "../core/lint.js";

/**
 * A replacement that carries a value through unchanged keeps the expression the
 * author wrote. Substituting the number it evaluates to produces a correct
 * instruction and a bad edit: it discards the name saying what the value means,
 * and freezes a number that was meant to follow the constant when it changes.
 */
const DEFS = "SCREEN_BW equ 320\nSCREEN_H equ 200\nSMALL equ 4\nBIG equ 100\n";

function replacement(instruction: string, ruleId: string): string | undefined {
  return lintSource(`${DEFS}\t${instruction}`, {
    processors: ["mc68000"],
  }).find((d) => d.ruleId === ruleId)?.suggestion?.replacement;
}

describe("replacements keep the symbols the source used", () => {
  test("a compound displacement survives intact", () => {
    expect(
      replacement(
        "adda.w #SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW),a3",
        "optimization/address-add-to-lea",
      ),
    ).toBe("\tlea SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW)(a3),a3");
  });

  test("an immediate passed straight through keeps its name", () => {
    expect(replacement("move.l #BIG,d0", "optimization/prefer-moveq")).toBe(
      "\tmoveq #BIG,d0",
    );
    expect(replacement("add.l #SMALL,d0", "optimization/prefer-addq")).toBe(
      "\taddq.l #SMALL,d0",
    );
    expect(replacement("sub.l #SMALL,d0", "optimization/prefer-subq")).toBe(
      "\tsubq.l #SMALL,d0",
    );
    expect(
      replacement("move.l #BIG,-(sp)", "optimization/push-immediate-pea"),
    ).toBe("\tpea BIG.w");
  });

  test("the base a number was written in is preserved too", () => {
    const found = lintSource(
      "\tmove.l (a0),d0\n\tand.l #$3f,d0\n\tmoveq #0,d7\n\trts",
      { processors: ["mc68000"] },
    );
    expect(
      found.find((d) => d.ruleId === "optimization/mask-via-moveq")?.suggestion
        ?.replacement,
    ).toContain("#$3f");
  });

  // An assembler ends the operand field at the first space, so a faithful copy
  // would truncate to `SCREEN_BW`.
  test("whitespace inside an expression is removed", () => {
    expect(
      replacement(
        "adda.w #SCREEN_BW / 2 + 10,a3",
        "optimization/address-add-to-lea",
      ),
    ).toBe("\tlea SCREEN_BW/2+10(a3),a3");
  });

  // A displacement opening with "(" reads like an addressing mode.
  test("redundant enclosing parentheses are dropped", () => {
    expect(
      replacement(
        "adda.w #(SCREEN_BW*2),a3",
        "optimization/address-add-to-lea",
      ),
    ).toBe("\tlea SCREEN_BW*2(a3),a3");
  });

  describe("negation", () => {
    test("a bare symbol is negated in place", () => {
      expect(
        replacement("suba.w #SCREEN_BW,a3", "optimization/address-sub-to-lea"),
      ).toBe("\tlea -SCREEN_BW(a3),a3");
    });

    test("negating a minus gives the symbol back", () => {
      expect(
        replacement("lea -SMALL(a0),a0", "optimization/prefer-lea-quick"),
      ).toBe("\tsubq.w #SMALL,a0");
    });

    // Unary minus binds tighter than the operators inside, so `-SCREEN_BW/2`
    // would not be the negation of `SCREEN_BW/2`.
    test("a compound expression is wrapped rather than prefixed", () => {
      expect(
        replacement(
          "suba.w #SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW),a3",
          "optimization/address-sub-to-lea",
        ),
      ).toBe("\tlea -(SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW))(a3),a3");
    });
  });

  test("a literal number is still written as a number", () => {
    expect(
      replacement("adda.w #1610,a3", "optimization/address-add-to-lea"),
    ).toBe("\tlea 1610(a3),a3");
  });
});

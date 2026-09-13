import { lintSource } from "../core/lint.js";

/**
 * Suggestions keep the symbols the source wrote, which is what a person should
 * paste. 68kcounter reads the written form to pick an addressing mode, and a
 * compound displacement defeats that: `lea SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW)(a3),a3`
 * measures 6 bytes and 12 cycles where `lea 1610(a3),a3` measures 4 and 8. So a
 * rule that saves cycles was reported as a regression purely because of how its
 * replacement was spelled.
 *
 * The copy handed to the counter therefore has its operand expressions
 * collapsed to the values they evaluate to.
 */
const DEFS = "SCREEN_BW equ 320\nSCREEN_H equ 200\nBIG equ 100\n";

const diagnosticFor = (instruction: string, ruleId: string) =>
  lintSource(`${DEFS}\t${instruction}`, { processors: ["mc68000"] }).find(
    (d) => d.ruleId === ruleId,
  );

describe("a symbolic operand measures as its value", () => {
  const RULE = "optimization/address-add-to-lea";

  test("a compound expression measures the same as the number it evaluates to", () => {
    const symbolic = diagnosticFor(
      "adda.w #SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW),a3",
      RULE,
    )?.suggestion?.impact;
    const literal = diagnosticFor("adda.w #1610,a3", RULE)?.suggestion?.impact;

    expect(symbolic?.sizeBytes?.delta).toBe(literal?.sizeBytes?.delta);
    expect(symbolic?.execution?.cpuCycles?.delta).toBe(
      literal?.execution?.cpuCycles?.delta,
    );
    expect(symbolic?.assessment).toBe("improvement");
  });

  // Parentheses alone were enough to trigger the worst case, symbols or not.
  test("a parenthesised expression is not a regression either", () => {
    expect(
      diagnosticFor("adda.w #(SCREEN_H*2),a3", RULE)?.suggestion?.impact
        ?.assessment,
    ).toBe("improvement");
  });

  test("the suggestion still shows the symbols", () => {
    expect(
      diagnosticFor("adda.w #SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW),a3", RULE)
        ?.suggestion?.replacement,
    ).toContain("SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW)");
  });

  test("a negated compound expression measures correctly too", () => {
    const impact = diagnosticFor(
      "suba.w #SCREEN_BW/2+(SCREEN_H/2*SCREEN_BW),a3",
      "optimization/address-sub-to-lea",
    )?.suggestion?.impact;
    expect(impact?.assessment).toBe("improvement");
  });

  test("an unresolvable symbol is left as written rather than guessed at", () => {
    // NOT_DEFINED cannot be evaluated, so nothing is substituted and the
    // measurement is whatever the counter makes of the text.
    const found = lintSource("\tmove.l #NOT_DEFINED,d0", {
      processors: ["mc68000"],
    });
    expect(found.every((d) => d.ruleId !== "optimization/prefer-moveq")).toBe(
      true,
    );
  });

  // Substituting one would change which absolute form is chosen, and a branch
  // target is an address the measurement has no business rewriting.
  test("branch targets are still measured, not collapsed", () => {
    const impact = lintSource(
      ["\tbtst #7,d0", "\tbne .x", ".x:", "\tmoveq #0,d7", "\trts"].join("\n"),
      {
        processors: ["mc68000"],
      },
    ).find((d) => d.ruleId === "optimization/btst-sign-branch")?.suggestion
      ?.impact;
    expect(impact?.sizeBytes?.delta).toBe(-2);
  });
});

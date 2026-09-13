import { lintSource } from "../core/lint.js";

/**
 * `move.b dN,-(sp)` reserves a word and writes only its high byte, so reading
 * the word back brings the low byte out of whatever was in that slot. The
 * CLR.B is there to zero that, not anything from the register — which means a
 * slot already zero does not need it, and zeroing one once serves any number of
 * these shifts.
 *
 * Said rather than applied: nothing here can know what is in memory below SP,
 * and an interrupt pushes its frame exactly there, so the zero survives only
 * while nothing interrupts.
 */
const noteFor = (source: string, ruleId: string) =>
  (
    lintSource(source, { processors: ["mc68000"] }).find(
      (d) => d.ruleId === ruleId,
    )?.notes ?? []
  )
    .map((n) => n.message)
    .find((m) => m.includes("CLR.B"));

describe("the stack byte clear", () => {
  test("is explained where the sequence emits one", () => {
    const note = noteFor(
      "\tlsl.w #8,d0\n\tmoveq #0,d7\n\trts",
      "optimization/stack-word-shift-eight",
    );
    expect(note).toContain("already zero");
    expect(note).toContain("push a frame below SP");
  });

  test("and on the known-count form that emits one", () => {
    const source = "\tmoveq #9,d1\n\tlsl.w d1,d0\n\tmoveq #0,d1\n\trts";
    expect(
      noteFor(source, "optimization/stack-known-register-shift"),
    ).toBeDefined();
  });

  // These reach the same result by clearing the register first, so there is
  // nothing about the stack slot to say.
  test("is not mentioned where the sequence has no CLR.B", () => {
    expect(
      noteFor(
        "\tlsr.w #8,d0\n\tmoveq #0,d7\n\trts",
        "optimization/stack-word-shift-eight",
      ),
    ).toBeUndefined();
    expect(
      noteFor(
        "\tasr.w #8,d0\n\tmoveq #0,d7\n\trts",
        "optimization/stack-word-shift-eight",
      ),
    ).toBeUndefined();
    const lsr24 = "\tmoveq #24,d1\n\tlsr.l d1,d0\n\tmoveq #0,d1\n\trts";
    expect(
      noteFor(lsr24, "optimization/stack-known-register-shift"),
    ).toBeUndefined();
  });
});

import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const RULE = "suspicious/unbalanced-stack";
const found = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === RULE,
  );

describe("suspicious/unbalanced-stack", () => {
  test("flags a return with a push outstanding", () => {
    const d = found(
      ["save:", "move.l d0,-(sp)", "moveq #1,d0", "rts"].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].loc.line).toBe(4);
    expect(d[0].message).toContain("4 bytes");
  });

  test("accepts a matched push and pop", () => {
    expect(
      found(
        ["f:", "move.l d0,-(sp)", "moveq #1,d0", "move.l (sp)+,d0", "rts"].join(
          "\n",
        ),
      ),
    ).toHaveLength(0);
  });

  test("counts MOVEM registers", () => {
    expect(
      found(
        ["f:", "movem.l d0-d3/a0,-(sp)", "movem.l (sp)+,d0-d3", "rts"].join(
          "\n",
        ),
      ),
    ).toHaveLength(1);
    expect(
      found(
        ["f:", "movem.l d0-d3/a0,-(sp)", "movem.l (sp)+,d0-d3/a0", "rts"].join(
          "\n",
        ),
      ),
    ).toHaveLength(0);
  });

  test("a byte push takes two bytes", () => {
    expect(
      found(["f:", "move.b d0,-(sp)", "addq.l #2,sp", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("follows stack adjustments", () => {
    expect(
      found(
        [
          "f:",
          "pea x",
          "pea y",
          "lea 8(sp),sp",
          "rts",
          "x: rts",
          "y: rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
    expect(
      found(
        [
          "f:",
          "pea x",
          "pea y",
          "addq.l #4,sp",
          "rts",
          "x: rts",
          "y: rts",
        ].join("\n"),
      ),
    ).toHaveLength(1);
  });

  test("LINK and UNLK balance", () => {
    expect(
      found(
        ["f:", "link a6,#-8", "move.l d0,-(sp)", "unlk a6", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("calls are assumed to be balanced", () => {
    expect(
      found(
        [
          "f:",
          "move.l d0,-(sp)",
          "bsr g",
          "addq.l #4,sp",
          "rts",
          "g: rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("flags paths that disagree", () => {
    const d = found(
      [
        "f:",
        "tst.w d0",
        "beq.s .skip",
        "move.l d1,-(sp)",
        ".skip:",
        "moveq #0,d0",
        "rts",
      ].join("\n"),
    );
    expect(d.some((x) => x.message.includes("disagree"))).toBe(true);
  });

  test("a push on one path that is popped on it is balanced", () => {
    expect(
      found(
        [
          "f:",
          "tst.w d0",
          "beq.s .skip",
          "move.l d1,-(sp)",
          "move.l (sp)+,d1",
          ".skip:",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("a push in a loop is a disagreement, not an endless climb", () => {
    expect(
      found(["f:", ".l:", "move.l d0,-(sp)", "dbra d1,.l", "rts"].join("\n"))
        .length,
    ).toBeGreaterThan(0);
  });

  test("popping more than was pushed is not reported", () => {
    expect(
      found(
        [
          "f:",
          "move.l (sp)+,a0",
          "move.l a0,-(sp)",
          "move.l (sp)+,a0",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("goes quiet after a macro", () => {
    expect(
      found(["f:", "move.l d0,-(sp)", "mymacro", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("each global label starts a routine at zero", () => {
    expect(
      found(
        ["f:", "rts", "g:", "move.l d0,-(sp)", "move.l (sp)+,d0", "rts"].join(
          "\n",
        ),
      ),
    ).toHaveLength(0);
  });

  test("a local label belongs to its own routine", () => {
    // Both routines have a `.l`; a branch must reach the one in its own.
    expect(
      found(
        [
          "a:",
          "moveq #3,d0",
          ".l:",
          "nop",
          "dbra d0,.l",
          "rts",
          "b:",
          "move.l d0,-(sp)",
          ".l:",
          "nop",
          "dbra d1,.l",
          "move.l (sp)+,d0",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });
});

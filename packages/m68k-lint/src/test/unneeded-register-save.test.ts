import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const RULE = "optimization/unneeded-register-save";
const run = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === RULE,
  );

describe("optimization/unneeded-register-save", () => {
  test("flags a register saved but never changed", () => {
    const d = run(
      [
        "f:",
        "movem.l d0-d2,-(sp)",
        "moveq #1,d0",
        "moveq #2,d1",
        "movem.l (sp)+,d0-d2",
        "rts",
      ].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].loc.line).toBe(2);
    expect(d[0].message).toContain("D2");
    expect(d[0].suggestion?.description).toContain("D0/D1");
  });

  test("suggests removing the save when nothing is changed", () => {
    const d = run(
      ["f:", "movem.l d0-d1,-(sp)", "nop", "movem.l (sp)+,d0-d1", "rts"].join(
        "\n",
      ),
    );
    expect(d).toHaveLength(1);
    expect(d[0].suggestion?.description).toContain("Remove the save");
  });

  test("supports PUSHM and POPM", () => {
    const d = run(
      [
        "f:",
        "PUSHM d0-d2/a0",
        "moveq #1,d0",
        "lea x,a0",
        "POPM d0-d2/a0",
        "rts",
        "x: dc.w 0",
      ].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("D1/D2");
    expect(d[0].suggestion?.description).toContain("D0/A0");
  });

  test("a save that is fully used is fine", () => {
    expect(
      run(
        [
          "f:",
          "movem.l d0-d1,-(sp)",
          "moveq #1,d0",
          "moveq #2,d1",
          "movem.l (sp)+,d0-d1",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("a partial write counts as a change", () => {
    expect(
      run(
        [
          "f:",
          "movem.l d0,-(sp)",
          "move.b d1,d0",
          "movem.l (sp)+,d0",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("a call in between could change anything", () => {
    expect(
      run(
        [
          "f:",
          "movem.l d0-d2,-(sp)",
          "bsr g",
          "movem.l (sp)+,d0-d2",
          "rts",
          "g: rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("a macro in between could change anything", () => {
    expect(
      run(["f:", "PUSHM d0-d2", "mymacro", "POPM d0-d2", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("stack offsets make the list load-bearing", () => {
    expect(
      run(
        [
          "f:",
          "movem.l d0-d2,-(sp)",
          "move.l 12(sp),d3",
          "movem.l (sp)+,d0-d2",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("a path that returns without restoring is not analysed", () => {
    expect(
      run(
        [
          "f:",
          "movem.l d0-d2,-(sp)",
          "tst.w d3",
          "beq.s .early",
          "movem.l (sp)+,d0-d2",
          "rts",
          ".early:",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("every exit restoring the same list is understood", () => {
    const d = run(
      [
        "f:",
        "movem.l d0-d2,-(sp)",
        "moveq #1,d0",
        "tst.w d3",
        "beq.s .early",
        "movem.l (sp)+,d0-d2",
        "rts",
        ".early:",
        "movem.l (sp)+,d0-d2",
        "rts",
      ].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].notes?.[0].message).toContain("6, 9");
  });
});

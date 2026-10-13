import { parseFile } from "m68k-parser";
import { applyFixes } from "../core/fix.js";
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

  describe("fix", () => {
    const fix = (source: string) =>
      applyFixes(
        source,
        (text) =>
          lintSource(text, { processors: ["mc68000"] }).filter(
            (d) => d.ruleId === RULE,
          ),
        {
          accept: ["safe"],
          verify: (candidate) => parseFile(candidate).errors.length === 0,
        },
      ).output;

    test("trims the save and every matching restore together", () => {
      const [d] = run(
        [
          "f:",
          "movem.l d0-d3/a0,-(sp)",
          "moveq #1,d0",
          "lea x,a0",
          "tst.w d1",
          "beq.s .early",
          "movem.l (sp)+,d0-d3/a0",
          "rts",
          ".early:",
          "movem.l (sp)+,d0-d3/a0",
          "rts",
          "x: dc.w 0",
        ].join("\n"),
      );
      expect(d.suggestion).toMatchObject({
        applicability: "safe",
        replacement: "\tmovem.l d0/a0,-(sp)",
        edits: [
          {
            span: { startLine: 7, endLine: 7 },
            replacement: "\tmovem.l (sp)+,d0/a0",
          },
          {
            span: { startLine: 10, endLine: 10 },
            replacement: "\tmovem.l (sp)+,d0/a0",
          },
        ],
      });
    });

    test("keeps labels, comments, case and spacing on every line it edits", () => {
      expect(
        fix(
          [
            "Draw:",
            "\t\tMOVEM.L\tD0-D3,-(SP)\t\t; save",
            "\t\tmoveq\t#1,d0",
            "\t\tmoveq\t#2,d1",
            ".exit:\t\tMOVEM.L\t(SP)+,D0-D3\t\t; restore",
            "\t\trts",
          ].join("\n"),
        ),
      ).toBe(
        [
          "Draw:",
          "\t\tMOVEM.L\tD0/D1,-(SP)\t\t; save",
          "\t\tmoveq\t#1,d0",
          "\t\tmoveq\t#2,d1",
          ".exit:\t\tMOVEM.L\t(SP)+,D0/D1\t\t; restore",
          "\t\trts",
        ].join("\n"),
      );
    });

    test("removes the save and its restores when nothing needs saving", () => {
      expect(
        fix(
          [
            "f:",
            "\tmovem.l\td2/d3,-(sp)",
            "\tnop",
            ".out:\tmovem.l\t(sp)+,d2/d3",
            "\trts",
          ].join("\n"),
        ),
      ).toBe(["f:", "\tnop", ".out:", "\trts"].join("\n"));
    });

    test("rewrites PUSHM and POPM in their own form", () => {
      const [d] = run(
        [
          "f:",
          "PUSHM d0-d2",
          "moveq #1,d0",
          "moveq #2,d1",
          "POPM d0-d2",
          "rts",
        ].join("\n"),
      );
      expect(d.suggestion).toMatchObject({
        applicability: "safe",
        replacement: "\tPUSHM d0/d1",
        edits: [{ replacement: "\tPOPM d0/d1" }],
      });
    });

    describe("with one register left", () => {
      test("uses MOVE, and keeps the line's spelling", () => {
        const [d] = run(
          [
            "f:",
            "MOVEM.L D0-D2,-(SP)",
            "moveq #1,d0",
            "MOVEM.L (SP)+,D0-D2",
            "rts",
          ].join("\n"),
        );
        expect(d.suggestion).toMatchObject({
          description: expect.stringContaining("with MOVE"),
          replacement: "\tMOVE.L D0,-(SP)",
          edits: [{ replacement: "\tMOVE.L (SP)+,D0" }],
        });
      });

      test("writes PUSHM and POPM as MOVE", () => {
        const [d] = run(
          ["f:", "PUSHM d0-d2", "moveq #1,d0", "POPM d0-d2", "rts"].join("\n"),
        );
        expect(d.suggestion).toMatchObject({
          replacement: "\tMOVE.L d0,-(sp)",
          edits: [{ replacement: "\tMOVE.L (sp)+,d0" }],
        });
      });

      test("is conditional where the flags MOVE sets may still be read", () => {
        // The restore sets N/Z/V/C just before the return, where a caller
        // could test them; MOVEM left them as they were.
        const [d] = run(
          [
            "f:",
            "movem.l d0-d2,-(sp)",
            "moveq #1,d0",
            "movem.l (sp)+,d0-d2",
            "rts",
          ].join("\n"),
        );
        expect(d.suggestion?.applicability).toBe("conditional");
        expect(d.notes?.at(-1)?.message).toContain("N/Z/V/C");
        expect(d.notes?.at(-1)?.message).toContain("line 4");
      });

      test("is safe where the flags are set again before anything reads them", () => {
        const [d] = run(
          [
            "f:",
            "movem.l d0-d2,-(sp)",
            "moveq #1,d0",
            "movem.l (sp)+,d0-d2",
            "tst.w d4",
            "rts",
          ].join("\n"),
        );
        expect(d.suggestion).toMatchObject({
          applicability: "safe",
          replacement: "\tmove.l d0,-(sp)",
        });
      });

      test("keeps MOVEM on the 68020, where MOVE is not known to be cheaper", () => {
        const [d] = lintSource(
          fixture(
            [
              "f:",
              "movem.l d0-d2,-(sp)",
              "moveq #1,d0",
              "movem.l (sp)+,d0-d2",
              "rts",
            ].join("\n"),
          ),
          { processors: ["mc68020"] },
        ).filter((one) => one.ruleId === RULE);
        expect(d.suggestion).toMatchObject({
          applicability: "safe",
          replacement: "\tmovem.l d0,-(sp)",
        });
      });
    });

    test.each([
      // A word restore sign-extends, so it does change the register.
      ["movem.w d0-d1,-(sp)", "movem.w (sp)+,d0-d1"],
      // A bare POPM names no list to trim.
      ["PUSHM d0-d1", "POPM"],
    ])("leaves %s … %s to be done by hand", (save, restore) => {
      const [d] = run(["f:", save, "moveq #1,d0", restore, "rts"].join("\n"));
      expect(d.suggestion).toMatchObject({ applicability: "manual" });
      expect(d.suggestion?.replacement).toBeUndefined();
      expect(d.suggestion?.edits).toBeUndefined();
    });
  });
});

import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const RULE = "suspicious/unused-comparison";
const found = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === RULE,
  );

describe("suspicious/unused-comparison", () => {
  test("flags a comparison overwritten before any branch", () => {
    const d = found(["f:", "cmp.w d0,d1", "moveq #1,d2", "rts"].join("\n"));
    expect(d).toHaveLength(1);
    expect(d[0].loc.line).toBe(2);
  });

  test("flags a TST on a register that no branch follows", () => {
    expect(
      found(["f:", "tst.w d0", "add.w d1,d2", "rts"].join("\n")),
    ).toHaveLength(1);
  });

  test("accepts a comparison followed by a branch", () => {
    expect(
      found(["f:", "cmp.w d0,d1", "beq.s .x", "nop", ".x:", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("accepts a comparison whose flags reach a Scc", () => {
    expect(
      found(["f:", "cmp.w d0,d1", "seq d2", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("leaves flags handed to the caller alone", () => {
    expect(found(["f:", "tst.l d0", "rts"].join("\n"))).toHaveLength(0);
  });

  test("leaves flags reaching a call alone", () => {
    expect(
      found(["f:", "cmp.w d0,d1", "bsr g", "rts", "g: rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("leaves flags reaching a macro alone", () => {
    expect(
      found(["f:", "cmp.w d0,d1", "mymacro", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("does not report TST on memory, which touches hardware", () => {
    expect(
      found(["f:", "tst.w (a6)", "btst #6,2(a6)", "bne.s f", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("flags a BTST nobody branches on", () => {
    expect(
      found(["f:", "btst #3,d0", "moveq #0,d1", "rts"].join("\n")),
    ).toHaveLength(1);
  });

  test("a branch on only one path still counts as a use", () => {
    expect(
      found(
        ["f:", "cmp.w d0,d1", "tst.w d3", "beq.s .x", "nop", ".x:", "rts"].join(
          "\n",
        ),
      ),
    ).toHaveLength(1);
    // The first CMP is overwritten by TST, so it is the one reported.
  });
});

describe("overwritten comparison explanations", () => {
  test.each(["cmp.w d0,d1", "tst.w d0", "tst.w (a0)"])(
    "explains the overwrite and branch after %s",
    (comparison) => {
      const d = found(`${comparison}\nmove.w (a1),d2\nbgt .end\n.end:\nrts`);
      expect(d).toHaveLength(1);
      expect(d[0].message).toContain("before BGT on line 3");
      expect(d[0].notes?.[0].message).toContain(
        "MOVE on line 2 overwrites N/V/Z",
      );
      expect(d[0].notes?.map((n) => n.loc?.line)).toEqual([2, 3]);
      expect(d[0].suggestion?.applicability).toBe("manual");
      expect(d[0].suggestion?.replacement).toBeUndefined();
    },
  );

  test.each(["seq d3", "dbeq d3,.end"])("explains %s", (use) => {
    const d = found(`tst.w d0\nmove.w d1,d2\n${use}\n.end:\nrts`);
    expect(d[0].message).toContain(`before ${use.split(" ")[0].toUpperCase()}`);
  });

  test("does not associate an earlier comparison with a later explicit test", () => {
    const d = found(
      "cmp.w d0,d1\nmove.w d2,d3\nbtst #0,d4\nbgt .end\n.end:\nrts",
    );
    // BTST is itself an explicit test: don't attribute its later branch to CMP.
    expect(d[0].message).not.toContain("before BGT");
  });

  test("follows flag-preserving instructions", () => {
    const d = found(
      "tst.w d0\nmove.w d1,d2\nlea 4(a0),a0\nbeq .end\n.end:\nrts",
    );
    expect(d[0].notes?.[0].loc?.line).toBe(2);
    expect(d[0].message).toContain("before BEQ on line 4");
  });

  test("uses the latest overwrite", () => {
    const d = found(
      "cmp.w d0,d1\nmove.w d2,d3\nadd.w d4,d5\nbeq .end\n.end:\nrts",
    );
    expect(d[0].notes?.[0].message).toContain("ADD on line 3 overwrites Z");
  });

  test("identifies multiple writers of a condition's flags", () => {
    const d = found(
      "cmp.w d0,d1\nmove.w d2,d3\nbset #0,d4\nbgt .end\n.end:\nrts",
    );
    expect(d[0].notes?.[0].message).toContain("MOVE on line 2 overwrites N/V");
    expect(d[0].notes?.[1].message).toContain("BSET on line 3 overwrites Z");
    expect(d[0].notes?.[2].loc?.line).toBe(4);
  });

  test.each([
    "cmp.w d0,d1\nbtst #0,d2\nbgt .end\n.end:\nrts",
    "tst.w d0\nlea 4(a0),a0\nbeq .end\n.end:\nrts",
  ])("does not call preserved comparison flags unused", (source) => {
    expect(found(source)).toHaveLength(0);
  });

  test.each([
    "move.w d1,d2\njsr other\nbeq .end",
    "move.w d1,d2\nopaque_macro\nbeq .end",
    "move.w d1,d2\nrts\nbeq .end",
  ])("does not explain a conditional use across a boundary", (tail) => {
    const d = found(`cmp.w d0,d1\n${tail}\n.end:\nrts`);
    expect(d[0].message).not.toContain("before BEQ");
  });

  test("does not attribute a branch through a join", () => {
    const d = found(
      "beq .join\ncmp.w d0,d1\nmove.w d2,d3\n.join:\nbeq .end\n.end:\nrts",
    );
    expect(d[0].message).not.toContain("before BEQ");
  });
});

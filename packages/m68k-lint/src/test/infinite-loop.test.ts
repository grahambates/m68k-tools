import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const RULE = "suspicious/infinite-loop";
const found = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === RULE,
  );

describe("suspicious/infinite-loop", () => {
  test("flags an exit test on a register the loop never changes", () => {
    const d = found(
      [
        "wait:",
        ".loop:",
        "cmp.w d1,d0",
        "beq.s .done",
        "addq.w #1,d2",
        "bra.s .loop",
        ".done:",
        "rts",
      ].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].loc.line).toBe(4);
    expect(d[0].message).toContain("D0, D1");
  });

  test("flags a test whose flags are set before the loop", () => {
    expect(
      found(
        [
          "wait:",
          "tst.w d0",
          ".loop:",
          "addq.l #1,a1",
          "bne.s .loop",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(1);
  });

  test("accepts a loop that updates its counter", () => {
    expect(
      found(
        [
          "count:",
          ".loop:",
          "clr.b (a0)+",
          "subq.w #1,d0",
          "bne.s .loop",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("accepts a loop that polls memory", () => {
    expect(
      found(
        [
          "wait:",
          ".loop:",
          "tst.w flag",
          "beq.s .loop",
          "rts",
          "flag: dc.w 0",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("accepts a loop that exits through a DBRA", () => {
    expect(
      found(
        ["fill:", ".loop:", "clr.b (a0)+", "dbra d0,.loop", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("accepts a loop containing a call", () => {
    expect(
      found(
        [
          "wait:",
          ".loop:",
          "bsr poll",
          "cmp.w d1,d0",
          "bne.s .loop",
          "rts",
          "poll: rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("does not report a loop with no exit", () => {
    expect(found(["halt:", ".loop:", "bra.s .loop"].join("\n"))).toHaveLength(
      0,
    );
  });
});

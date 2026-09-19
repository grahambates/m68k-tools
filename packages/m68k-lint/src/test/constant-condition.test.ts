import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const RULE = "suspicious/constant-condition";
const found = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === RULE,
  );

describe("suspicious/constant-condition", () => {
  test("flags a branch that is never taken after MOVEQ #0", () => {
    const d = found(
      ["f:", "moveq #0,d0", "bne.s .x", "nop", ".x:", "rts"].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("never taken");
    expect(d[0].loc.line).toBe(3);
  });

  test("flags a branch that is always taken", () => {
    const d = found(
      ["f:", "moveq #0,d0", "beq.s .x", "nop", ".x:", "rts"].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("always taken");
  });

  test("evaluates a compare of two known values", () => {
    expect(
      found(
        [
          "f:",
          "moveq #5,d0",
          "cmp.l #5,d0",
          "bne.s .x",
          "nop",
          ".x:",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(1);
    expect(
      found(
        [
          "f:",
          "moveq #5,d0",
          "cmp.l #6,d0",
          "bne.s .x",
          "nop",
          ".x:",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(1);
  });

  test("signed and unsigned conditions differ", () => {
    // 5 - 3 = 2: unsigned higher and signed greater.
    const higher = found(
      [
        "f:",
        "moveq #5,d0",
        "cmp.l #3,d0",
        "bhi.s .x",
        "nop",
        ".x:",
        "rts",
      ].join("\n"),
    );
    expect(higher[0].message).toContain("always taken");
    // $FFFFFFFF is -1 signed but the largest unsigned value.
    const signed = found(
      [
        "f:",
        "moveq #-1,d0",
        "cmp.l #1,d0",
        "blt.s .x",
        "nop",
        ".x:",
        "rts",
      ].join("\n"),
    );
    expect(signed[0].message).toContain("always taken");
    const unsigned = found(
      [
        "f:",
        "moveq #-1,d0",
        "cmp.l #1,d0",
        "bcs.s .x",
        "nop",
        ".x:",
        "rts",
      ].join("\n"),
    );
    expect(unsigned[0].message).toContain("never taken");
  });

  test("respects the operand size", () => {
    // $0100 as a byte is zero.
    expect(
      found(
        [
          "f:",
          "move.l #$100,d0",
          "tst.b d0",
          "bne.s .x",
          "nop",
          ".x:",
          "rts",
        ].join("\n"),
      )[0].message,
    ).toContain("never taken");
  });

  test("flags a Scc with a fixed result", () => {
    const d = found(["f:", "moveq #0,d0", "seq d1", "rts"].join("\n"));
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("$FF");
  });

  test("says nothing when the value is not known", () => {
    expect(
      found(["f:", "tst.w d0", "bne.s .x", "nop", ".x:", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("says nothing when a partial write hides the value", () => {
    expect(
      found(
        [
          "f:",
          "moveq #0,d0",
          "move.w d1,d0",
          "bne.s .x",
          "nop",
          ".x:",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("says nothing when paths disagree", () => {
    expect(
      found(
        [
          "f:",
          "tst.w d3",
          "beq.s .a",
          "moveq #0,d0",
          "bra.s .b",
          ".a:",
          "moveq #1,d0",
          ".b:",
          "tst.l d0",
          "bne.s .c",
          "nop",
          ".c:",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("reports when every path gives the same answer", () => {
    expect(
      found(
        [
          "f:",
          "tst.w d3",
          "beq.s .a",
          "moveq #0,d0",
          "bra.s .b",
          ".a:",
          "moveq #0,d0",
          ".b:",
          "tst.l d0",
          "bne.s .c",
          "nop",
          ".c:",
          "rts",
        ].join("\n"),
      ),
    ).toHaveLength(1);
  });

  test("a loop that changes the value is not constant", () => {
    expect(
      found(
        ["f:", "moveq #10,d0", ".l:", "subq.l #1,d0", "bne.s .l", "rts"].join(
          "\n",
        ),
      ),
    ).toHaveLength(0);
  });
});

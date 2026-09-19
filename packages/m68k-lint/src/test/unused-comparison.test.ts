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

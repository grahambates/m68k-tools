import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const found = (source: string) =>
  lintSource(fixture(source), { processors: ["mc68020"] }).filter(
    (d) => d.ruleId === "suspicious/division-result-width",
  );

describe("suspicious/division-result-width", () => {
  // M68000 PRM, DIVS/DIVU: successful word division packs 16r:16q.
  // No constant operands are needed to identify a subsequent long use.
  test.each(["divu.w", "divs.w", "divu", "DIVS.W"])(
    "flags a numeric use after %s with unknown operands",
    (division) => {
      const diagnostics = found(`${division} d1,d0\nadd.l d0,d2`);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].loc.line).toBe(2);
      expect(diagnostics[0].suggestion?.applicability).toBe("manual");
      expect(diagnostics[0].suggestion?.replacement).toBeUndefined();
    },
  );

  test.each([
    "cmp.l #10,d0",
    "tst.l d0",
    "move.l d0,a0",
    "adda.l d0,a0",
    "divu.w d2,d0",
    "move.b (a0,d0.l),d2",
    "lea (a0,d0.l),a1",
    "nop\nsub.l d0,d2",
    "move.l d0,(a1)\nadd.l d0,d2",
    "move.w d0,d2\nadd.l d0,d3",
  ])("flags a packed result consumed by %s", (use) => {
    expect(found(`divu.w d1,d0\n${use}`)).toHaveLength(1);
  });

  test.each([
    "move.w d0,d2",
    "add.w d0,d2",
    "move.b (a0,d0.w),d2",
    "move.l d0,(a0)",
    "move.l d0,d2",
    "movem.l d0,-(sp)",
    "swap d0\nmove.w d0,d2",
    "lsr.l #8,d0\nadd.l d0,d2",
    "andi.l #$ffff,d0\nadd.l d0,d2",
    "ext.l d0\nadd.l d0,d2",
    "clr.l d0\nadd.l d0,d2",
    "moveq #0,d0\nadd.l d0,d2",
    "move.w d2,d0\nadd.l d0,d2",
    "jsr other\nadd.l d0,d2",
    "opaque_macro\nadd.l d0,d2",
    "rts\nadd.l d0,d2",
    "bvs .overflow\nadd.l d0,d2\n.overflow:\nrts",
    "bra .loop\n.loop:\nbra .loop",
  ])("leaves intentional or ambiguous use alone: %s", (use) => {
    expect(found(`divu.w d1,d0\n${use}`)).toHaveLength(0);
  });

  test("does not merge results from different predecessors", () => {
    expect(found("beq .use\ndivu.w d1,d0\n.use:\nadd.l d0,d2")).toHaveLength(0);
  });

  test("accepts long division", () => {
    expect(found("divu.l d1,d0\nadd.l d0,d2")).toHaveLength(0);
  });

  test("does not confuse a word divisor with a long dividend", () => {
    expect(found("divu.w d1,d0\ndivu.w d0,d2")).toHaveLength(0);
  });

  test("gives the appropriate signedness advice", () => {
    expect(
      found("divs.w d1,d0\nadd.l d0,d2")[0].suggestion?.description,
    ).toContain("EXT.L");
    expect(
      found("divu.w d1,d0\nadd.l d0,d2")[0].suggestion?.description,
    ).toContain("$FFFF");
  });
});

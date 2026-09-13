import { parseFile } from "m68k-parser";
import { getFlagSemantics } from "../semantics/flags.js";
import { lintSource } from "../core/lint.js";

/**
 * CMPA is not an address-register write. It stores nothing, and like every
 * compare it sets N, Z, V and C from the subtraction while leaving X. Grouping
 * it with MOVEA, ADDA and SUBA, which genuinely leave the condition codes
 * alone, made an ordinary compare-and-branch look like a branch reading a
 * condition nothing had set.
 */
const writes = (source: string) =>
  [...getFlagSemantics(parseFile(source).lines[0]).writes].sort().join("");

const ids = (lines: string[]) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] }).map(
    (d) => d.ruleId,
  );

describe("CMPA sets the condition codes", () => {
  test("both sizes write N, Z, V and C", () => {
    expect(writes("\tcmpa.l a2,a0")).toBe("CNVZ");
    expect(writes("\tcmpa.w d2,a0")).toBe("CNVZ");
  });

  test("it matches the other compares", () => {
    expect(writes("\tcmpa.l a2,a0")).toBe(writes("\tcmp.l d2,d0"));
  });

  // These really do leave CCR alone, and must stay that way.
  test("the address forms that preserve CCR still preserve it", () => {
    for (const source of [
      "\tmovea.l a2,a0",
      "\tadda.l d2,a0",
      "\tsuba.l d2,a0",
      "\tlea 4(a0),a0",
    ]) {
      expect(writes(source)).toBe("");
    }
  });

  test("PEA, EXG, LINK and UNLK still preserve it", () => {
    for (const source of [
      "\tpea 4(a0)",
      "\texg d0,d1",
      "\tlink a6,#-4",
      "\tunlk a6",
    ]) {
      expect(writes(source)).toBe("");
    }
  });
});

describe("branching on a CMPA result", () => {
  test("a compare and branch is not a preserved-CCR branch", () => {
    const source = [
      "\tmove.l\t#CopBlitEnd,d1",
      "\tcmpa.l\ta2,a0",
      "\tbeq.s\t.noFaces",
      ".noFaces:",
      "\trts",
    ];
    expect(ids(source)).not.toContain(
      "suspicious/condition-after-preserved-ccr",
    );
    expect(ids(source)).not.toContain("suspicious/stale-condition-code");
  });

  // The rule still has to earn its keep: ADDA really does preserve CCR, so a
  // branch after one is reading whatever came before it.
  test("a branch after ADDA is still reported", () => {
    const source = ["\tadda.w\t#4,a0", "\tbeq\t.done", ".done:", "\trts"];
    expect(ids(source)).toContain("suspicious/stale-condition-code");
  });
});

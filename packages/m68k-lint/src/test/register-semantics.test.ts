import { parseLine } from "m68k-parser";
import { getRegisterSemantics } from "../semantics/registers.js";
import { fixtureContext } from "./helpers.js";

const semantics = (text: string) => {
  const s = getRegisterSemantics(parseLine(`\t${text}`).value);
  return {
    reads: [...s.reads].sort(),
    writes: [...s.writes].sort(),
    partial: [...s.partialWrites].sort(),
    unknown: s.unknownEffects,
  };
};

describe("register semantics", () => {
  describe("a shift or rotate written with one operand", () => {
    test("acts on that operand alone", () => {
      expect(semantics("lsr.w d7")).toMatchObject({
        reads: ["d7"],
        writes: ["d7"],
      });
      expect(semantics("rol.w d2")).toMatchObject({
        reads: ["d2"],
        writes: ["d2"],
      });
    });

    test("on memory reads only the registers that address it", () => {
      expect(semantics("asl.w (a0)+")).toMatchObject({
        reads: ["a0"],
        writes: ["a0"],
      });
    });

    test("leaves the two-operand form as it was", () => {
      expect(semantics("lsr.w d1,d2")).toMatchObject({
        reads: ["d1", "d2"],
        writes: ["d2"],
      });
    });

    test("no longer leaves a constant in the register", () => {
      const ctx = fixtureContext(["moveq #4,d0", "lsr.w d0", "nop"].join("\n"));
      expect(ctx.registers.knownConstantBefore(2, "d0")).toBeUndefined();
    });
  });

  describe("instructions that used to be opaque", () => {
    test("Scc writes the byte of its destination and reads nothing of it", () => {
      expect(semantics("seq.b d3")).toEqual({
        reads: [],
        writes: ["d3"],
        partial: ["d3"],
        unknown: false,
      });
      expect(semantics("st.b d0")).toMatchObject({ writes: ["d0"] });
      expect(semantics("sne.b (a1)")).toMatchObject({
        reads: ["a1"],
        writes: [],
      });
    });

    test("Scc under the synonym spellings", () => {
      expect(semantics("shs.b d0").unknown).toBe(false);
      expect(semantics("slo.b d0").unknown).toBe(false);
    });

    test("SUB and SWAP are not mistaken for Scc", () => {
      expect(semantics("sub.w d0,d1")).toMatchObject({
        reads: ["d0", "d1"],
        writes: ["d1"],
      });
      expect(semantics("swap d0")).toMatchObject({ reads: ["d0"] });
    });

    test("PEA reads its address registers and pushes through A7", () => {
      expect(semantics("pea 4(a0)")).toMatchObject({
        reads: ["a0", "a7"],
        writes: ["a7"],
        unknown: false,
      });
    });

    test("CHK reads both operands and writes nothing", () => {
      expect(semantics("chk.w d1,d2")).toEqual({
        reads: ["d1", "d2"],
        writes: [],
        partial: [],
        unknown: false,
      });
    });

    test("NBCD works on its destination in place", () => {
      expect(semantics("nbcd.b d0")).toMatchObject({
        reads: ["d0"],
        writes: ["d0"],
        partial: ["d0"],
      });
    });

    test("ADDX, SUBX, ABCD and SBCD update a destination that is also an input", () => {
      for (const op of ["addx.b", "subx.w", "abcd.b", "sbcd.b"])
        expect(semantics(`${op} d1,d2`)).toMatchObject({
          reads: ["d1", "d2"],
          writes: ["d2"],
          unknown: false,
        });
      expect(semantics("addx.l -(a1),-(a2)")).toMatchObject({
        reads: ["a1", "a2"],
        writes: ["a1", "a2"],
      });
    });

    test("CMPM reads both operands and steps both address registers", () => {
      expect(semantics("cmpm.b (a0)+,(a1)+")).toMatchObject({
        reads: ["a0", "a1"],
        writes: ["a0", "a1"],
        unknown: false,
      });
    });

    test("MOVEP in either direction", () => {
      expect(semantics("movep.w d0,4(a1)")).toMatchObject({
        reads: ["a1", "d0"],
        writes: [],
      });
      expect(semantics("movep.l 4(a1),d0")).toMatchObject({
        reads: ["a1"],
        writes: ["d0"],
        partial: [],
      });
    });
  });
});

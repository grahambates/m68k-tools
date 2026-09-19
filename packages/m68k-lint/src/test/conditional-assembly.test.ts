import { lintSource } from "../core/lint.js";
import { conditionalAssembly } from "../analysis/conditionals.js";
import { fixture, fixtureContext } from "./helpers.js";

const run = (rule: string, source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === rule,
  );

/** Which 1-based lines of a fixture are left out. */
const leftOut = (source: string) => {
  const ctx = fixtureContext(source);
  return conditionalAssembly(ctx.file)
    .unassembled.map((left, i) => (left ? i + 1 : 0))
    .filter(Boolean);
};

describe("conditional assembly", () => {
  describe("which arm is assembled", () => {
    test("IF on a literal", () => {
      expect(
        leftOut(["IF 1", "nop", "ELSE", "rts", "ENDC"].join("\n")),
      ).toEqual([4]);
      expect(
        leftOut(["IF 0", "nop", "ELSE", "rts", "ENDC"].join("\n")),
      ).toEqual([2]);
    });

    test("each comparison form", () => {
      const arm = (form: string, value: number) =>
        leftOut([`${form} ${value}`, "nop", "ENDC"].join("\n")).length === 0;
      expect(arm("IFEQ", 0)).toBe(true);
      expect(arm("IFEQ", 1)).toBe(false);
      expect(arm("IFNE", 1)).toBe(true);
      expect(arm("IFGT", 1)).toBe(true);
      expect(arm("IFGT", 0)).toBe(false);
      expect(arm("IFGE", 0)).toBe(true);
      expect(arm("IFLT", -1)).toBe(true);
      expect(arm("IFLE", 0)).toBe(true);
      expect(arm("IFLE", 1)).toBe(false);
    });

    test("IFC and IFNC on strings", () => {
      const left = (text: string) =>
        leftOut([`\t${text}`, "\tnop", "\tENDC"].join("\n")).length > 0;
      expect(left('ifc "a","a"')).toBe(false);
      expect(left('ifc "a","b"')).toBe(true);
      expect(left("ifc a,a")).toBe(false);
      expect(left("ifc a,b")).toBe(true);
      expect(left('ifc "a",a')).toBe(false);
      expect(left("ifnc a,b")).toBe(false);
      expect(left("ifnc a,a")).toBe(true);
      // Compared exactly, so case matters.
      expect(left("ifc a,A")).toBe(true);
    });

    test("a constant the file defines", () => {
      const source = ["DEBUG equ 0", "IF DEBUG", "nop", "ENDC"].join("\n");
      expect(leftOut(source)).toEqual([3]);
    });

    test("an expression over constants", () => {
      const source = [
        "A equ 2",
        "B equ 3",
        "IF A+B=5",
        "nop",
        "ELSE",
        "rts",
        "ENDC",
      ].join("\n");
      expect(leftOut(source)).toEqual([6]);
    });

    test("ELSEIF takes the first arm that holds", () => {
      const source = [
        "IF 0",
        "nop",
        "ELSEIF 1",
        "moveq #1,d0",
        "ELSEIF 1",
        "moveq #2,d0",
        "ELSE",
        "rts",
        "ENDC",
      ].join("\n");
      expect(leftOut(source)).toEqual([2, 6, 8]);
    });

    test("nested blocks", () => {
      const source = [
        "IF 1",
        "IF 0",
        "nop",
        "ENDC",
        "moveq #1,d0",
        "ENDC",
      ].join("\n");
      expect(leftOut(source)).toEqual([3]);
    });

    test("code inside an arm not taken is left out however deep", () => {
      const source = ["IF 0", "IF 1", "nop", "ENDC", "ENDC"].join("\n");
      expect(leftOut(source)).toEqual([2, 3, 4]);
    });

    test("IFD and IFND on a name the file defines earlier", () => {
      const source = [
        "DEBUG equ 1",
        "IFD DEBUG",
        "nop",
        "ENDC",
        "IFND DEBUG",
        "rts",
        "ENDC",
      ].join("\n");
      expect(leftOut(source)).toEqual([6]);
    });

    test("IFMACROD on a macro the file defines earlier", () => {
      const source = [
        "M: macro",
        "nop",
        "endm",
        "IFMACROD M",
        "rts",
        "ENDC",
        "IFMACROND M",
        "moveq #1,d0",
        "ENDC",
      ].join("\n");
      expect(leftOut(source)).toEqual([8]);
    });
  });

  describe("undecided stays undecided", () => {
    test("a name the file does not define", () => {
      expect(
        leftOut(["IF DEBUG", "nop", "ELSE", "rts", "ENDC"].join("\n")),
      ).toEqual([]);
    });

    test("IFC on text the parse does not keep whole", () => {
      expect(
        leftOut(['\tifc "a b",c d', "\tnop", "\tENDC"].join("\n")),
      ).toEqual([]);
      expect(leftOut(["\tifc \\1,a", "\tnop", "\tENDC"].join("\n"))).toEqual(
        [],
      );
    });

    test("IFD on a name not defined here, which may come from the command line", () => {
      expect(leftOut(["IFD DEBUG", "nop", "ENDC"].join("\n"))).toEqual([]);
      expect(leftOut(["IFND DEBUG", "nop", "ENDC"].join("\n"))).toEqual([]);
    });

    test("a name defined after the condition", () => {
      expect(
        leftOut(["IFD LATER", "nop", "ENDC", "LATER equ 1"].join("\n")),
      ).toEqual([]);
    });

    test("a constant defined two ways", () => {
      const source = ["X equ 1", "X equ 0", "IF X", "nop", "ENDC"].join("\n");
      expect(leftOut(source)).toEqual([]);
    });

    test("an arm after an undecided one is not assumed", () => {
      // The first condition is unknown, so the ELSEIF might be reached and taken.
      const source = [
        "IF UNKNOWN",
        "nop",
        "ELSEIF 1",
        "rts",
        "ELSE",
        "moveq #1,d0",
        "ENDC",
      ].join("\n");
      expect(leftOut(source)).toEqual([6]);
    });

    test("string comparisons", () => {
      // Not settled without the text of the line, as in a hand-built parse.
      expect(leftOut(["IFC a b,c", "nop", "ENDC"].join("\n"))).toEqual([]);
    });

    test("a block inside a macro definition", () => {
      const source = ["M: macro", "IF 0", "nop", "ENDC", "endm"].join("\n");
      expect(leftOut(source)).toEqual([]);
    });
  });

  describe("what it does to the rest", () => {
    test("a constant defined in each arm is no longer a conflict", () => {
      const source = ["IF 1", "X equ 1", "ELSE", "X equ 2", "ENDC"].join("\n");
      expect(fixtureContext(source).symbols.evaluate("X")).toEqual({
        known: true,
        value: 1,
      });
    });

    test("a constant defined in an arm can decide a later condition", () => {
      const source = [
        "IF 1",
        "MODE equ 2",
        "ENDC",
        "IFEQ MODE-2",
        "nop",
        "ELSE",
        "rts",
        "ENDC",
      ].join("\n");
      expect(leftOut(source)).toEqual([7]);
    });

    test("an arm that is assembled overwrites what came before it", () => {
      const source = [
        "start:",
        "moveq #1,d0",
        "IFEQ 0",
        "moveq #2,d0",
        "ENDC",
        "move.l d0,d1",
        "rts",
      ].join("\n");
      // With no way to tell the arm runs, the first MOVEQ could still be read.
      expect(run("suspicious/dead-register-write", source)).toHaveLength(1);
    });

    test("an arm that is not assembled changes nothing", () => {
      const source = [
        "start:",
        "moveq #1,d0",
        "IFNE 0",
        "moveq #2,d0",
        "ENDC",
        "move.l d0,d1",
        "rts",
      ].join("\n");
      expect(run("suspicious/dead-register-write", source)).toHaveLength(0);
    });

    test("an undecided condition is treated as before", () => {
      const source = [
        "start:",
        "moveq #1,d0",
        "IF UNKNOWN",
        "moveq #2,d0",
        "ENDC",
        "move.l d0,d1",
        "rts",
      ].join("\n");
      expect(run("suspicious/dead-register-write", source)).toHaveLength(0);
    });

    test("a write inside an arm that is not assembled is not called dead", () => {
      const source = [
        "start:",
        "IFNE 0",
        "moveq #1,d0",
        "ENDC",
        "moveq #2,d0",
        "rts",
      ].join("\n");
      expect(run("suspicious/dead-register-write", source)).toHaveLength(0);
    });

    test("stack depth follows the arm that is assembled", () => {
      const pushed = ["f:", "IF 1", "move.l d0,-(sp)", "ENDC", "rts"].join(
        "\n",
      );
      expect(run("suspicious/unbalanced-stack", pushed)).toHaveLength(1);
      const skipped = ["f:", "IF 0", "move.l d0,-(sp)", "ENDC", "rts"].join(
        "\n",
      );
      expect(run("suspicious/unbalanced-stack", skipped)).toHaveLength(0);
    });

    test("byte parity runs through a decided block", () => {
      const source = [
        "dc.b 1",
        "IF 1",
        "dc.b 2",
        "ENDC",
        "dc.b 3",
        "moveq #0,d0",
      ].join("\n");
      expect(run("suspicious/missing-even", source)).toHaveLength(1);
    });

    test("bytes in an arm that is not assembled are not counted", () => {
      const source = ["dc.b 1", "IF 0", "dc.b 2", "ENDC", "moveq #0,d0"].join(
        "\n",
      );
      expect(run("suspicious/missing-even", source)).toHaveLength(1);
      const even = ["dc.b 1", "IF 1", "dc.b 2", "ENDC", "moveq #0,d0"].join(
        "\n",
      );
      expect(run("suspicious/missing-even", even)).toHaveLength(0);
    });

    test("parity is unknown across a block that is not decided", () => {
      const source = [
        "dc.b 1",
        "IF UNKNOWN",
        "dc.b 2",
        "ENDC",
        "moveq #0,d0",
      ].join("\n");
      expect(run("suspicious/missing-even", source)).toHaveLength(0);
    });
  });
});

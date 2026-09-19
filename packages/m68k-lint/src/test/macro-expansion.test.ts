import { lintSource } from "../core/lint.js";
import { expansionOf } from "../semantics/macro-expansions.js";
import { getFlagSemantics } from "../semantics/flags.js";
import { getRegisterSemantics } from "../semantics/registers.js";
import { fixture, fixtureContext } from "./helpers.js";

const run = (rule: string, source: string) =>
  lintSource(fixture(source), { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === rule,
  );

/** The macro call on a 1-based line of a fixture. */
const callAt = (source: string, line: number) => {
  const ctx = fixtureContext(source);
  return ctx.file.lines[line - 1];
};

describe("macro expansion", () => {
  test("a call to a simple macro takes on the registers its body uses", () => {
    const source = [
      "CLEAR: macro",
      "moveq #0,\\1",
      "move.l \\2,d3",
      "endm",
      "start:",
      "CLEAR d0,a1",
      "rts",
    ].join("\n");
    const semantics = getRegisterSemantics(callAt(source, 6));
    expect([...semantics.writes].sort()).toEqual(["d0", "d3"]);
    expect([...semantics.reads]).toEqual(["a1"]);
    expect(semantics.unknownEffects).toBe(false);
  });

  test("both definition forms are understood", () => {
    const source = [
      "macro ONE",
      "moveq #1,d1",
      "endm",
      "TWO: macro",
      "moveq #2,d2",
      "endm",
      "start:",
      "ONE",
      "TWO",
    ].join("\n");
    expect(expansionOf(callAt(source, 8))).toHaveLength(1);
    expect(expansionOf(callAt(source, 9))).toHaveLength(1);
  });

  test("a register read after the macro writes it is not a read of the call", () => {
    const source = [
      "SWAPIN: macro",
      "move.l \\1,d0",
      "add.l d0,d1",
      "endm",
      "start:",
      "SWAPIN a0",
    ].join("\n");
    const semantics = getRegisterSemantics(callAt(source, 6));
    expect([...semantics.reads].sort()).toEqual(["a0", "d1"]);
  });

  test("flags follow whichever instruction touched them last", () => {
    const source = [
      "TESTIT: macro",
      "cmp.w \\1,\\2",
      "moveq #0,d7",
      "endm",
      "start:",
      "TESTIT d0,d1",
    ].join("\n");
    const flags = getFlagSemantics(callAt(source, 6));
    expect([...flags.writes].sort()).toEqual(["C", "N", "V", "Z"]);
    expect(flags.undefined.size).toBe(0);
  });

  test("a macro that reads the flags is seen to", () => {
    const source = ["ISEQ: macro", "seq \\1", "endm", "start:", "ISEQ d1"].join(
      "\n",
    );
    expect([...getFlagSemantics(callAt(source, 5)).reads]).toEqual(["Z"]);
  });

  test("the size the macro was called with reaches the body", () => {
    const source = [
      "LOAD: macro",
      "move.\\0 \\1,d0",
      "endm",
      "start:",
      "LOAD.w d1",
    ].join("\n");
    const [line] = expansionOf(callAt(source, 5)) ?? [];
    expect(line?.qualifier).toMatchObject({ type: "size", size: "w" });
  });

  test("an argument is a whole expression or register where the body puts one", () => {
    const source = [
      "FETCH: macro",
      "move.l \\1(a0),d0",
      "move.l (\\2),d1",
      "endm",
      "start:",
      "FETCH 8+2,a3",
    ].join("\n");
    const semantics = getRegisterSemantics(callAt(source, 6));
    expect([...semantics.reads].sort()).toEqual(["a0", "a3"]);
    expect(semantics.unknownEffects).toBe(false);
  });

  test("an argument can build a register name", () => {
    const source = [
      "ZERO: macro",
      "moveq #0,d\\1",
      "endm",
      "start:",
      "ZERO 3",
    ].join("\n");
    expect([...getRegisterSemantics(callAt(source, 5)).writes]).toEqual(["d3"]);
  });

  test("a call to another macro is seen through", () => {
    const source = [
      "INNER: macro",
      "moveq #1,\\1",
      "endm",
      "OUTER: macro",
      "INNER \\1",
      "moveq #2,d7",
      "endm",
      "start:",
      "OUTER d4",
    ].join("\n");
    const semantics = getRegisterSemantics(callAt(source, 9));
    expect([...semantics.writes].sort()).toEqual(["d4", "d7"]);
    expect(semantics.unknownEffects).toBe(false);
  });

  describe("conditional assembly in the body", () => {
    const writes = (definition: string[], call: string) => {
      const source = [...definition, "start:", call].join("\n");
      const expansion = expansionOf(callAt(source, definition.length + 2));
      return {
        expansion,
        writes: [
          ...getRegisterSemantics(callAt(source, definition.length + 2)).writes,
        ].sort(),
      };
    };
    const macro = [
      "M: macro",
      "if narg>1",
      "moveq #1,\\2",
      "else",
      "moveq #0,d0",
      "endc",
      "endm",
    ];

    test("the arm for the arguments given is taken", () => {
      expect(writes(macro, "M a,d3").writes).toEqual(["d3"]);
      expect(writes(macro, "M a").writes).toEqual(["d0"]);
    });

    test("ifb picks the arm for a missing argument", () => {
      const optional = [
        "M: macro",
        "ifb \\2",
        "moveq #0,d1",
        "else",
        "moveq #0,\\2",
        "endc",
        "endm",
      ];
      expect(writes(optional, "M x").writes).toEqual(["d1"]);
      expect(writes(optional, "M x,d5").writes).toEqual(["d5"]);
    });

    test("code in an arm not taken is not looked at", () => {
      // \2 is not supplied, so that arm could not be read, but it is not taken.
      expect(writes(macro, "M a").expansion).toBeDefined();
    });

    test("a condition over a constant the file defines", () => {
      const source = [
        "MODE equ 2",
        "M: macro",
        "ifeq MODE-2",
        "moveq #0,d4",
        "endc",
        "endm",
        "start:",
        "M",
      ].join("\n");
      expect([...getRegisterSemantics(callAt(source, 8)).writes]).toEqual([
        "d4",
      ]);
    });

    test("nested blocks", () => {
      const nested = [
        "M: macro",
        "if narg>0",
        "if narg>1",
        "moveq #0,d2",
        "else",
        "moveq #0,d1",
        "endc",
        "endc",
        "endm",
      ];
      expect(writes(nested, "M a").writes).toEqual(["d1"]);
      expect(writes(nested, "M a,b").writes).toEqual(["d2"]);
      expect(writes(nested, "M").writes).toEqual([]);
    });
  });

  test("NARG is the number of arguments given", () => {
    const source = [
      "COUNT: macro",
      "moveq #NARG,d0",
      "endm",
      "start:",
      "COUNT a,b,c",
    ].join("\n");
    const [line] = expansionOf(callAt(source, 5)) ?? [];
    expect(line?.operands?.[0]).toMatchObject({
      type: "immediate",
      value: { value: 3 },
    });
  });

  describe("stays opaque when it cannot be sure", () => {
    const opaque = (definition: string[], call: string) => {
      const source = [...definition, "start:", call].join("\n");
      const line = callAt(source, definition.length + 2);
      expect(expansionOf(line)).toBeUndefined();
      expect(getRegisterSemantics(line).unknownEffects).toBe(true);
    };

    test("a body with a label", () => {
      opaque(["M: macro", ".l:", "nop", "endm"], "M");
    });

    test("a body that branches", () => {
      opaque(["M: macro", "beq.s .x", ".x:", "endm"], "M");
    });

    test("a condition that cannot be settled", () => {
      opaque(["M: macro", "if UNKNOWN", "nop", "endc", "endm"], "M");
    });

    test("a block that is never closed", () => {
      opaque(["M: macro", "if narg>1", "nop", "endm"], "M");
    });

    test("a body that calls a macro it cannot expand", () => {
      opaque(["M: macro", "OTHER", "endm"], "M");
    });

    test("a macro that calls itself", () => {
      opaque(["M: macro", "nop", "M", "endm"], "M");
    });

    test("a body with a unique label", () => {
      opaque(["M: macro", ".l\\@: nop", "bra.s .l\\@", "endm"], "M");
    });

    test("a call with too few arguments", () => {
      opaque(["M: macro", "move.l \\1,\\2", "endm"], "M d0");
    });

    test("a macro defined twice", () => {
      opaque(["M: macro", "nop", "endm", "M: macro", "nop", "endm"], "M");
    });

    test("an undefined macro", () => {
      opaque([], "UNKNOWN d0");
    });

    test("a call before the definition", () => {
      const source = ["start:", "M", "M: macro", "nop", "endm"].join("\n");
      expect(expansionOf(callAt(source, 2))).toBeUndefined();
    });
  });
});

describe("rules that see through a macro", () => {
  test("a write before a macro that does not read it is dead", () => {
    const source = [
      "SETD1: macro",
      "moveq #5,d1",
      "endm",
      "start:",
      "moveq #1,d0",
      "SETD1",
      "moveq #2,d0",
      "rts",
    ].join("\n");
    expect(run("suspicious/dead-register-write", source)).toHaveLength(1);
  });

  test("a write the macro reads is not dead", () => {
    const source = [
      "USED0: macro",
      "move.l d0,d1",
      "endm",
      "start:",
      "moveq #1,d0",
      "USED0",
      "moveq #2,d0",
      "rts",
    ].join("\n");
    expect(run("suspicious/dead-register-write", source)).toHaveLength(0);
  });

  test("a comparison before a macro that leaves the flags alone is unused", () => {
    const source = [
      "FILL: macro",
      "move.l \\1,a0",
      "endm",
      "start:",
      "cmp.w d0,d1",
      "FILL a1",
      "moveq #0,d2",
      "rts",
    ].join("\n");
    // MOVEA does not touch the flags, so the CMP is overwritten by MOVEQ.
    expect(run("suspicious/unused-comparison", source)).toHaveLength(1);
  });

  test("a comparison before a macro that branches on it is used", () => {
    const source = [
      "ISEQ: macro",
      "seq \\1",
      "endm",
      "start:",
      "cmp.w d0,d1",
      "ISEQ d2",
      "rts",
    ].join("\n");
    expect(run("suspicious/unused-comparison", source)).toHaveLength(0);
  });

  test("a comparison before a macro that is not defined stays unknown", () => {
    const source = ["start:", "cmp.w d0,d1", "UNDEFINED d2", "rts"].join("\n");
    expect(run("suspicious/unused-comparison", source)).toHaveLength(0);
  });

  test("stack depth follows a macro that pushes", () => {
    const source = [
      "PUSH: macro",
      "move.l \\1,-(sp)",
      "endm",
      "start:",
      "PUSH d0",
      "rts",
    ].join("\n");
    expect(run("suspicious/unbalanced-stack", source)).toHaveLength(1);
  });

  test("a macro that pops balances one that pushes", () => {
    const source = [
      "PUSH: macro",
      "move.l \\1,-(sp)",
      "endm",
      "POP: macro",
      "move.l (sp)+,\\1",
      "endm",
      "start:",
      "PUSH d0",
      "POP d0",
      "rts",
    ].join("\n");
    expect(run("suspicious/unbalanced-stack", source)).toHaveLength(0);
  });

  test("byte parity survives a macro of plain instructions", () => {
    const source = [
      "NOP2: macro",
      "nop",
      "nop",
      "endm",
      "msg: dc.b 'abc'",
      "NOP2",
      "moveq #0,d0",
    ].join("\n");
    // The odd address is still reported, and once, at the first instruction.
    const d = run("suspicious/missing-even", source);
    expect(d).toHaveLength(1);
  });

  test("a loop that changes its counter through a macro is not endless", () => {
    const source = [
      "DEC: macro",
      "subq.w #1,\\1",
      "endm",
      "wait:",
      ".loop:",
      "DEC d0",
      "bne.s .loop",
      "rts",
    ].join("\n");
    expect(run("suspicious/infinite-loop", source)).toHaveLength(0);
  });
});

describe("PUSHM and POPM", () => {
  test("PUSHM with a list and POPM without one balance", () => {
    expect(
      run(
        "suspicious/unbalanced-stack",
        ["f:", "PUSHM d0-d3/a0", "moveq #1,d0", "POPM", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("POPM without a list restores what PUSHM saved, nested", () => {
    expect(
      run(
        "suspicious/unbalanced-stack",
        ["f:", "PUSHM d0-d3", "PUSHM a0-a1", "POPM", "POPM", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
    // One POPM short leaves the outer save on the stack.
    expect(
      run(
        "suspicious/unbalanced-stack",
        ["f:", "PUSHM d0-d3", "PUSHM a0-a1", "POPM", "rts"].join("\n"),
      ),
    ).toHaveLength(1);
  });

  test("an unpaired POPM is left alone", () => {
    expect(
      run("suspicious/unbalanced-stack", ["f:", "POPM", "rts"].join("\n")),
    ).toHaveLength(0);
  });

  test("a save with no list at the top is not misread", () => {
    expect(
      run(
        "suspicious/unbalanced-stack",
        ["f:", "PUSHM", "POPM", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("unneeded-register-save sees PUSHM with a bare POPM", () => {
    const d = run(
      "optimization/unneeded-register-save",
      ["f:", "PUSHM d0-d2", "moveq #1,d0", "POPM", "rts"].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("D1/D2");
  });

  test("movem-restore-mismatch compares PUSHM with POPM", () => {
    const d = run(
      "suspicious/movem-restore-mismatch",
      ["f:", "PUSHM d0-d3", "moveq #1,d0", "POPM d0-d2", "rts"].join("\n"),
    );
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("d3");
  });

  test("a POPM that matches its PUSHM raises nothing", () => {
    expect(
      run(
        "suspicious/movem-restore-mismatch",
        ["f:", "PUSHM d0-d3", "moveq #1,d0", "POPM d0-d3", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
  });
});

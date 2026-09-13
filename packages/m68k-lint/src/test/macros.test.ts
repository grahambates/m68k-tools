import { lintSource } from "../core/lint.js";

/**
 * A macro invocation expands into instructions the linter cannot see, and a
 * macro definition emits nothing where it is written. Both were invisible to
 * the analysis: the parser gives a macro call `mnemonic.type === "macro"`, which
 * fell through every `type === "instruction"` filter, so a call was modelled as
 * a no-op reading no registers.
 *
 * These fixtures are written with real tabs rather than through the shared
 * `fixture` helper, because a macro's name sits in column zero and its body is
 * indented; normalising the indentation would rewrite the thing under test.
 */
const lint = (lines: string[], ruleId?: string) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] })
    .filter((d) => !ruleId || d.ruleId === ruleId)
    .map((d) => `${d.ruleId}@${d.loc.line}`);

const DEAD_WRITE = "suspicious/dead-register-write";

describe("macro invocations are opaque", () => {
  test("a register the macro goes on to read is not a dead write", () => {
    expect(
      lint(
        [
          "start:",
          "\tmove.w #100,d0",
          "\tSetColor d0",
          "\tmove.w #200,d0",
          "\trts",
        ],
        DEAD_WRITE,
      ),
    ).toEqual([]);
  });

  test("a macro taking no operands still clobbers what we cannot see", () => {
    expect(
      lint(
        [
          "start:",
          "\tmove.w #100,d0",
          "\tWaitVBlank",
          "\tmove.w #200,d0",
          "\trts",
        ],
        DEAD_WRITE,
      ),
    ).toEqual([]);
  });

  test("the same code without the macro is still reported", () => {
    expect(
      lint(
        ["start:", "\tmove.w #100,d0", "\tmove.w #200,d0", "\trts"],
        DEAD_WRITE,
      ),
    ).toEqual([`${DEAD_WRITE}@2`]);
  });

  // The replacement spans the matched run, so fusing across a call would have
  // deleted it.
  test("a sequence rule does not fuse instructions across a macro call", () => {
    const split = [
      "\tmove.l a6,-(sp)",
      "\tTraceEntry",
      "\tmove.l sp,a6",
      "\tadd.w #-32,sp",
      "\tmoveq #0,d0",
      "\trts",
    ];
    expect(lint(split)).not.toContain("optimization/prefer-link-sequence@1");

    const joined = [
      "\tmove.l a6,-(sp)",
      "\tmove.l sp,a6",
      "\tadd.w #-32,sp",
      "\tmoveq #0,d0",
      "\trts",
    ];
    expect(lint(joined)).toContain("optimization/prefer-link-sequence@1");
  });
});

describe("macro definitions emit no code where they are written", () => {
  test("flow does not run through a definition body", () => {
    // The body never executes here, so d0 is overwritten without being read.
    const source = [
      "\tmove.w #100,d0",
      "MyMacro macro",
      "\tmove.w d0,d3",
      "\tendm",
      "\tmove.w #200,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([`${DEAD_WRITE}@1`]);
  });

  test("a write the body itself overwrites is dead in every expansion", () => {
    const source = [
      "MyMacro macro",
      "\tmove.w #1,d0",
      "\tmove.w #2,d0",
      "\trts",
      "\tendm",
      "start:",
      "\tnop",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([`${DEAD_WRITE}@2`]);
  });

  test("a body's final write is not dead, since the caller may read it", () => {
    expect(
      lint(
        ["MyMacro macro", "\tmove.w #1,d0", "\tendm", "start:", "\tnop"],
        DEAD_WRITE,
      ),
    ).toEqual([]);
  });
});

describe("REPT assembles its body more than once", () => {
  test("a value carried between iterations stays live", () => {
    const source = [
      "\tmove.w #100,d0",
      "\trept 4",
      "\tmove.w d0,d2",
      "\tmove.w #1,d0",
      "\tendr",
      "\tmove.w #200,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([]);
  });

  test("the equivalent DBF loop agrees", () => {
    const source = [
      "\tmove.w #100,d0",
      "\tmoveq #3,d7",
      ".lp:",
      "\tmove.w d0,d2",
      "\tmove.w #1,d0",
      "\tdbf d7,.lp",
      "\tmove.w #200,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([]);
  });

  test("a write dead within a single iteration is still reported", () => {
    expect(
      lint(
        ["\trept 4", "\tmove.w #1,d0", "\tmove.w #2,d0", "\tendr", "\trts"],
        DEAD_WRITE,
      ),
    ).toEqual([`${DEAD_WRITE}@2`]);
  });
});

describe("conditional assembly arms are alternatives", () => {
  // Exactly one arm is assembled. Treating the directives as ordinary skipped
  // lines ran the arms into each other, so a write in the first looked
  // overwritten by the second.
  test("a write in one arm is not overwritten by the next", () => {
    const source = [
      "\tifne\tSHADOW_ON",
      "\tmoveq\t#7-1,d7",
      "\telse",
      "\tmoveq\t#8-1,d7",
      "\tendc",
      "\tmove.w\td7,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([]);
  });

  test("with no ELSE the code below is reachable without the arm", () => {
    const source = [
      "\tmoveq\t#1,d7",
      "\tifne\tX",
      "\tmoveq\t#2,d7",
      "\tendc",
      "\tmove.w\td7,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([]);
  });

  test("ENDIF closes a block as well as ENDC", () => {
    const source = [
      "\tifne\tX",
      "\tmoveq\t#1,d7",
      "\telse",
      "\tmoveq\t#2,d7",
      "\tendif",
      "\tmove.w\td7,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([]);
  });

  test("a write dead within a single arm is still reported", () => {
    const source = [
      "\tifne\tX",
      "\tmoveq\t#1,d7",
      "\tmoveq\t#2,d7",
      "\telse",
      "\tmoveq\t#3,d7",
      "\tendc",
      "\tmove.w\td7,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([`${DEAD_WRITE}@2`]);
  });

  test("a write every arm overwrites is still reported", () => {
    const source = [
      "\tmoveq\t#0,d7",
      "\tifne\tX",
      "\tmoveq\t#1,d7",
      "\telse",
      "\tmoveq\t#2,d7",
      "\tendc",
      "\tmove.w\td7,d0",
      "\trts",
    ];
    expect(lint(source, DEAD_WRITE)).toEqual([`${DEAD_WRITE}@1`]);
  });

  test("nested blocks nest", () => {
    const source = [
      "\tifne\tA",
      "\tmoveq\t#1,d7",
      "\tifne\tB",
      "\tmoveq\t#2,d7",
      "\telse",
      "\tmoveq\t#3,d7",
      "\tendc",
      "\telse",
      "\tmoveq\t#4,d7",
      "\tendc",
      "\tmove.w\td7,d0",
      "\trts",
    ];
    // Every path out of the nested block rewrites D7, so line 2 is dead.
    expect(lint(source, DEAD_WRITE)).toEqual([`${DEAD_WRITE}@2`]);
  });
});

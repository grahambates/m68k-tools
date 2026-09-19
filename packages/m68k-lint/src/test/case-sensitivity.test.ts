import { lintSource } from "../core/lint.js";
import type { LintConfig } from "../core/config.js";
import { expansionOf } from "../semantics/macro-expansions.js";
import { fixture, fixtureContext } from "./helpers.js";

const run = (rule: string, source: string, config: Partial<LintConfig> = {}) =>
  lintSource(fixture(source), {
    processors: ["mc68000"],
    ...config,
  }).filter((d) => d.ruleId === rule);

const FOLDED = { caseSensitive: false };

describe("symbols keep their case by default", () => {
  test("Foo and foo are two constants", () => {
    const { symbols } = fixtureContext(["Foo equ 1", "foo equ 2"].join("\n"));
    expect(symbols.evaluate("Foo")).toEqual({ known: true, value: 1 });
    expect(symbols.evaluate("foo")).toEqual({ known: true, value: 2 });
  });

  test("a constant is not found in another case", () => {
    const { symbols } = fixtureContext("Foo equ 1");
    expect(symbols.evaluate("foo")).toEqual({
      known: false,
      reason: "unknown-symbol",
    });
  });

  test("a rule sees each constant's own value", () => {
    // Both constants fit MOVEQ, so each is suggested: neither was lost to a
    // conflict between Foo and foo.
    const found = run(
      "optimization/prefer-moveq",
      ["Foo equ 1", "foo equ 2", "move.l #Foo,d0", "move.l #foo,d1"].join("\n"),
    );
    expect(found).toHaveLength(2);
  });
});

describe("symbols fold case when the project says so", () => {
  test("Foo and foo are one constant, and two definitions of it conflict", () => {
    const source = ["Foo equ 1", "foo equ 2"].join("\n");
    const ctx = fixtureContext(source, { processors: ["mc68000"], ...FOLDED });
    expect(ctx.symbols.evaluate("FOO")).toEqual({
      known: false,
      reason: "unknown-symbol",
    });
  });

  test("a constant is found in another case", () => {
    const ctx = fixtureContext("Foo equ 1", {
      processors: ["mc68000"],
      ...FOLDED,
    });
    expect(ctx.symbols.evaluate("foo")).toEqual({ known: true, value: 1 });
  });

  test("the rule now sees the conflict", () => {
    const found = run(
      "optimization/prefer-moveq",
      ["Foo equ 1", "foo equ 2", "move.l #Foo,d0", "move.l #foo,d1"].join("\n"),
      FOLDED,
    );
    expect(found).toHaveLength(0);
  });
});

describe("local labels and branches", () => {
  const source = [
    "start:",
    "moveq #1,d0",
    "bra.s .Skip",
    "moveq #2,d0",
    ".skip:",
    "rts",
    ".Skip:",
    "moveq #3,d0",
    "rts",
  ].join("\n");

  test(".Skip and .skip are different labels by default", () => {
    // The BRA reaches .Skip. Nothing reaches .skip, so the run after the BRA,
    // through to .skip's RTS, is dead: two instructions.
    const [found] = run("suspicious/unreachable-code", source);
    expect(found.message).toContain("2 instructions");
  });

  test("they are one label when case is folded", () => {
    // Now .skip is the label the BRA names, so it is referenced and its RTS
    // is reachable. Only the MOVEQ between them is dead.
    const [found] = run("suspicious/unreachable-code", source, FOLDED);
    expect(found.message).toContain("this instruction");
  });

  test("routines Start and start are separate scopes by default", () => {
    const two = [
      "Start:",
      "bra.s .x",
      ".x:",
      "rts",
      "start:",
      "bra.s .x",
      ".x:",
      "rts",
    ].join("\n");
    expect(run("suspicious/unused-local-label", two)).toHaveLength(0);
  });
});

describe("branch target and label search", () => {
  test("BRA to the next line is found in the same case", () => {
    expect(
      run(
        "optimization/null-branch",
        ["bra.s Next", "Next:", "rts"].join("\n"),
      ),
    ).toHaveLength(1);
  });

  test("but not when the label is in another case", () => {
    expect(
      run(
        "optimization/null-branch",
        ["bra.s Next", "next:", "rts"].join("\n"),
      ),
    ).toHaveLength(0);
  });

  test("it is when case is folded", () => {
    expect(
      run(
        "optimization/null-branch",
        ["bra.s Next", "next:", "rts"].join("\n"),
        FOLDED,
      ),
    ).toHaveLength(1);
  });
});

describe("macros keep their case", () => {
  const define = ["Clear: macro", "moveq #0,\\1", "endm"];
  const callAt = (call: string, config?: Partial<LintConfig>) => {
    const ctx = fixtureContext([...define, "start:", call, "rts"].join("\n"), {
      processors: ["mc68000"],
      ...config,
    });
    return ctx.file.lines[4];
  };

  test("a call in the same case is expanded", () => {
    expect(expansionOf(callAt("Clear d3"))).toBeDefined();
  });

  test("a call in another case is not a call to it", () => {
    expect(expansionOf(callAt("clear d3"))).toBeUndefined();
  });

  test("a call in another case is expanded when case is folded", () => {
    expect(expansionOf(callAt("clear d3", FOLDED))).toBeDefined();
  });
});

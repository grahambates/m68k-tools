import { parseFile } from "m68k-parser";
import { buildProjectSymbols } from "../analysis/project-symbols.js";
import { DefaultSymbolTable } from "../analysis/symbols.js";
import { lintSource } from "../core/lint.js";

/**
 * Files are linted one at a time, so a constant an include defines is unknown,
 * and most rules depend on resolving constants. The index answers from the rest
 * of the project, but only for names the project agrees on: it may turn
 * "unknown" into "known" and must never turn "known" into "wrong".
 */
const index = (files: Record<string, string>) =>
  buildProjectSymbols(
    Object.entries(files).map(([path, source]) => ({ path, source })),
  );

const evaluate = (source: string, name: string) =>
  new DefaultSymbolTable(parseFile(source)).evaluate(name);

describe("the single-file table does not guess", () => {
  test("one definition resolves", () => {
    expect(evaluate("FOO equ 1", "FOO")).toEqual({ known: true, value: 1 });
  });

  test("two different definitions resolve to nothing, rather than the last one", () => {
    expect(evaluate("FOO equ 1\nFOO equ 2", "FOO")).toEqual({
      known: false,
      reason: "unknown-symbol",
    });
  });

  test("a definition repeated identically is not a conflict", () => {
    expect(evaluate("FOO equ 1\nFOO equ 1", "FOO")).toEqual({
      known: true,
      value: 1,
    });
  });

  test("arms of a conditional that disagree are a conflict", () => {
    const source = [
      "\tifne DEBUG",
      "FOO equ 1",
      "\telse",
      "FOO equ 2",
      "\tendc",
    ].join("\n");
    expect(evaluate(source, "FOO")).toEqual({
      known: false,
      reason: "unknown-symbol",
    });
  });

  // Most real constants live inside an include guard, so the conditional itself
  // must not be treated as making a definition uncertain.
  test("the include-guard idiom still resolves", () => {
    const source = [
      "\tifnd GUARD",
      "GUARD equ 1",
      "FOO equ $dff000",
      "\tendc",
    ].join("\n");
    expect(evaluate(source, "FOO")).toEqual({ known: true, value: 0xdff000 });
  });

  test("a definition inside a macro body is not a file constant", () => {
    expect(evaluate("M macro\nFOO equ 7\n\tendm", "FOO")).toEqual({
      known: false,
      reason: "unknown-symbol",
    });
  });
});

describe("the project index", () => {
  test("answers for a name only one file defines, and says where from", () => {
    const symbols = index({ "include/hw.i": "CUSTOM equ $dff000" });
    expect(symbols.lookup("CUSTOM")).toEqual({
      value: 0xdff000,
      origin: "include/hw.i",
    });
  });

  test("resolves a definition written in terms of another", () => {
    const symbols = index({
      "a.i": "BASE equ $dff000",
      "b.i": "DMACON equ BASE+$96",
    });
    expect(symbols.lookup("DMACON")?.value).toBe(0xdff096);
  });

  test("refuses a name two files define differently", () => {
    const symbols = index({
      "release.i": "DEBUG equ 0",
      "debug.i": "DEBUG equ 1",
    });
    expect(symbols.lookup("DEBUG")).toBeUndefined();
    expect(symbols.conflicts).toContain("DEBUG");
  });

  test("a header included by two files is not a conflict with itself", () => {
    const symbols = index({ "a.i": "FOO equ 5", "b.i": "FOO equ 5" });
    expect(symbols.lookup("FOO")?.value).toBe(5);
  });

  test("ignores definitions inside macro bodies", () => {
    expect(
      index({ "m.i": "M macro\nFOO equ 7\n\tendm" }).lookup("FOO"),
    ).toBeUndefined();
  });

  test("a cyclic definition terminates instead of resolving", () => {
    expect(
      index({ "a.i": "A equ B", "b.i": "B equ A" }).lookup("A"),
    ).toBeUndefined();
  });

  test("a file that will not parse does not sink the index", () => {
    const symbols = index({
      "good.i": "FOO equ 1",
      "bad.s": "   ((( unparseable",
    });
    expect(symbols.lookup("FOO")?.value).toBe(1);
  });
});

describe("using the index while linting", () => {
  const source = [
    "start:",
    "\tmoveq\t#SHIFT,d1",
    "\tlsl.l\td1,d0",
    "\tmove.l\td2,d3",
    "\trts",
  ].join("\n");
  const ruleId = "optimization/known-register-shift-to-clear";

  test("a rule can fire on a constant another file defines", () => {
    const found = lintSource(
      source,
      { processors: ["mc68000"] },
      undefined,
      index({ "hw.i": "SHIFT equ 32" }),
    );
    expect(found.map((d) => d.ruleId)).toContain(ruleId);
  });

  test("the diagnostic says which file the value came from", () => {
    const found = lintSource(
      source,
      { processors: ["mc68000"] },
      undefined,
      index({ "hw.i": "SHIFT equ 32" }),
    );
    const notes = (found.find((d) => d.ruleId === ruleId)?.notes ?? []).map(
      (n) => n.message,
    );
    expect(notes.join(" ")).toContain("SHIFT = 32 (from hw.i)");
  });

  test("a conflicting constant leaves the rule silent, as before the index existed", () => {
    const conflicted = index({ "a.i": "SHIFT equ 32", "b.i": "SHIFT equ 4" });
    expect(
      lintSource(
        source,
        { processors: ["mc68000"] },
        undefined,
        conflicted,
      ).map((d) => d.ruleId),
    ).not.toContain(ruleId);
  });

  test("without an index the file is analysed alone", () => {
    expect(
      lintSource(source, { processors: ["mc68000"] }).map((d) => d.ruleId),
    ).not.toContain(ruleId);
  });
});

describe("the project index and case", () => {
  const files = (a: string, b: string) => [
    { path: "a.i", source: a },
    { path: "b.i", source: b },
  ];

  test("keeps Foo and foo apart by default, as an assembler does", () => {
    const symbols = buildProjectSymbols(files("Foo equ 1", "foo equ 2"));
    expect(symbols.lookup("Foo")?.value).toBe(1);
    expect(symbols.lookup("foo")?.value).toBe(2);
    expect(symbols.conflicts).toEqual([]);
  });

  test("does not find a name in the wrong case by default", () => {
    const symbols = buildProjectSymbols(files("Foo equ 1", ""));
    expect(symbols.lookup("foo")).toBeUndefined();
  });

  test("treats them as one name when case is folded", () => {
    const symbols = buildProjectSymbols(files("Foo equ 1", "foo equ 2"), {
      caseSensitive: false,
    });
    // Two values for one name is a conflict, so neither answers.
    expect(symbols.lookup("Foo")).toBeUndefined();
    expect(symbols.conflicts).toEqual(["foo"]);
  });

  test("finds a name in either case when case is folded", () => {
    const symbols = buildProjectSymbols(files("Foo equ 1", ""), {
      caseSensitive: false,
    });
    expect(symbols.lookup("FOO")?.value).toBe(1);
    expect(symbols.lookup("foo")?.value).toBe(1);
  });
});

import { buildProjectSymbols } from "../analysis/project-symbols.js";
import { lintSource } from "../core/lint.js";
import { fixture } from "./helpers.js";

const index = (files: Record<string, string>) =>
  buildProjectSymbols(
    Object.entries(files).map(([path, source]) => ({
      path,
      source: fixture(source),
    })),
  );

const run = (
  rule: string,
  source: string,
  files: Record<string, string> = {},
) =>
  lintSource(
    fixture(source),
    { processors: ["mc68000"] },
    undefined,
    index(files),
  ).filter((d) => d.ruleId === rule);

const setD1 = ["SETD1: macro", "moveq #5,d1", "endm"].join("\n");

describe("project macro index", () => {
  test("answers a macro defined once", () => {
    const found = index({ "macros.i": setD1 }).macro?.("SETD1");
    expect(found?.origin).toBe("macros.i");
    expect(found?.definition.name).toBe("SETD1");
  });

  test("answers when every definition agrees", () => {
    expect(
      index({ "a.i": setD1, "b.i": setD1 }).macro?.("SETD1"),
    ).toBeDefined();
  });

  test("answers nothing when definitions differ", () => {
    const other = ["SETD1: macro", "moveq #6,d1", "endm"].join("\n");
    expect(index({ "a.i": setD1, "b.i": other }).macro?.("SETD1")).toBe(
      undefined,
    );
  });

  test("ignores a macro defined inside another macro's body", () => {
    const nested = ["OUTER: macro", "INNER: macro", "nop", "endm", "endm"].join(
      "\n",
    );
    const symbols = index({ "a.i": nested });
    expect(symbols.macro?.("OUTER")).toBeDefined();
    expect(symbols.macro?.("INNER")).toBeUndefined();
  });

  test("answers nothing for an unknown name", () => {
    expect(index({ "a.i": setD1 }).macro?.("MISSING")).toBeUndefined();
  });
});

describe("macros defined in another file", () => {
  const dead = "suspicious/dead-register-write";
  const main = ["start:", "moveq #1,d1", "SETD1", "move.l d1,d0", "rts"].join(
    "\n",
  );

  test("are seen through when the project defines them", () => {
    // The macro overwrites D1 before it is read, so the first MOVEQ is dead.
    expect(run(dead, main, { "macros.i": setD1, "main.s": main })).toHaveLength(
      1,
    );
  });

  test("stay opaque without a project index", () => {
    expect(
      lintSource(fixture(main), { processors: ["mc68000"] }).filter(
        (d) => d.ruleId === dead,
      ),
    ).toHaveLength(0);
  });

  test("stay opaque when the project defines them two ways", () => {
    const other = ["SETD1: macro", "moveq #6,d1", "endm"].join("\n");
    expect(
      run(dead, main, { "a.i": setD1, "b.i": other, "main.s": main }),
    ).toHaveLength(0);
  });

  test("the file's own definition takes precedence", () => {
    const own = [
      "SETD1: macro",
      "moveq #9,d2",
      "endm",
      "start:",
      "moveq #1,d1",
      "SETD1",
      "move.l d1,d0",
      "rts",
    ].join("\n");
    // Its own SETD1 writes D2, not D1, so the MOVEQ #1,D1 is used.
    expect(run(dead, own, { "macros.i": setD1, "main.s": own })).toHaveLength(
      0,
    );
  });

  test("a macro from an include can call another from the same include", () => {
    const header = [
      "INNER: macro",
      "moveq #5,\\1",
      "endm",
      "OUTER: macro",
      "INNER d1",
      "endm",
    ].join("\n");
    const source = [
      "start:",
      "moveq #1,d1",
      "OUTER",
      "move.l d1,d0",
      "rts",
    ].join("\n");
    expect(run(dead, source, { "macros.i": header })).toHaveLength(1);
  });
});

describe("project macro index and case", () => {
  test("does not find a macro in another case by default", () => {
    expect(index({ "a.i": setD1 }).macro?.("setd1")).toBeUndefined();
  });

  test("finds it in either case when case is folded", () => {
    const symbols = buildProjectSymbols(
      [{ path: "a.i", source: fixture(setD1) }],
      { caseSensitive: false },
    );
    expect(symbols.macro?.("setd1")).toBeDefined();
    expect(symbols.macro?.("SETD1")).toBeDefined();
  });
});

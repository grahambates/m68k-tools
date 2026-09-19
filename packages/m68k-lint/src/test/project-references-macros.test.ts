import { buildProjectReferences } from "../analysis/project-references.js";
import { lintSource } from "../core/lint.js";
import type { LintConfig } from "../core/config.js";
import { fixture } from "./helpers.js";

const references = (files: Record<string, string>) =>
  buildProjectReferences(
    Object.entries(files).map(([path, source]) => ({
      path,
      source: fixture(source),
    })),
  );

const CALL_INIT = ["CALLINIT: macro", "jsr Init_\\1", "endm"].join("\n");

describe("references made by a macro call", () => {
  test("a name a macro builds from its argument is referenced", () => {
    const index = references({
      "macros.i": CALL_INIT,
      "main.s": ["main:", "CALLINIT Sound", "rts"].join("\n"),
    });
    expect(index.references("Init_Sound")).toBe(true);
    expect(index.references("init_sound")).toBe(true);
  });

  test("a name the call does not build is not", () => {
    const index = references({
      "macros.i": CALL_INIT,
      "main.s": ["main:", "CALLINIT Sound", "rts"].join("\n"),
    });
    expect(index.references("Init_Video")).toBe(false);
  });

  test("works when the definition is in a file read later", () => {
    const index = references({
      "main.s": ["main:", "CALLINIT Sound", "rts"].join("\n"),
      "macros.i": CALL_INIT,
    });
    expect(index.references("Init_Sound")).toBe(true);
  });

  test("follows a macro that calls another", () => {
    const index = references({
      "macros.i": [
        "INNER: macro",
        "jsr Init_\\1",
        "endm",
        "OUTER: macro",
        "INNER \\1",
        "endm",
      ].join("\n"),
      "main.s": ["main:", "OUTER Video", "rts"].join("\n"),
    });
    expect(index.references("Init_Video")).toBe(true);
  });

  test("a constant named through a parameter is referenced", () => {
    const index = references({
      "macros.i": ["ENABLE: macro", "move.w #HW_\\1,d0", "endm"].join("\n"),
      "main.s": ["main:", "ENABLE DMA", "rts"].join("\n"),
    });
    expect(index.references("HW_DMA")).toBe(true);
  });

  test("a macro the project defines two ways is not expanded", () => {
    const other = ["CALLINIT: macro", "jsr Other_\\1", "endm"].join("\n");
    const index = references({
      "a.i": CALL_INIT,
      "b.i": other,
      "main.s": ["main:", "CALLINIT Sound", "rts"].join("\n"),
    });
    expect(index.references("Init_Sound")).toBe(false);
    expect(index.references("Other_Sound")).toBe(false);
  });

  test("a call to a macro nobody defines adds only what was written", () => {
    const index = references({
      "main.s": ["main:", "UNKNOWN Sound", "rts"].join("\n"),
    });
    expect(index.references("Sound")).toBe(true);
    expect(index.references("Init_Sound")).toBe(false);
  });
});

describe("the rules that read those references", () => {
  const enabled = (rule: string): LintConfig => ({
    processors: ["mc68000"],
    rules: { [rule]: "warning" },
  });
  const lint = (source: string, rule: string, files: Record<string, string>) =>
    lintSource(
      fixture(source),
      enabled(rule),
      undefined,
      undefined,
      references(files),
    ).filter((d) => d.ruleId === rule);

  test("a routine only called through a macro is not unused", () => {
    const main = [
      "main:",
      "CALLINIT Sound",
      "rts",
      "Init_Sound:",
      "rts",
      "Init_Video:",
      "rts",
    ].join("\n");
    const found = lint(main, "suspicious/unused-global-label", {
      "macros.i": CALL_INIT,
      "main.s": main,
    });
    const names = found.map((d) => d.message);
    expect(names.some((m) => m.includes("Init_Sound"))).toBe(false);
    expect(names.some((m) => m.includes("Init_Video"))).toBe(true);
  });

  test("a constant only used through a macro is not unused", () => {
    const header = ["HW_DMA equ 1", "HW_UNUSED equ 2"].join("\n");
    const main = ["main:", "ENABLE DMA", "rts"].join("\n");
    const found = lint(header, "suspicious/unused-constant", {
      "hw.i": header,
      "macros.i": ["ENABLE: macro", "move.w #HW_\\1,d0", "endm"].join("\n"),
      "main.s": main,
    });
    const names = found.map((d) => d.message);
    expect(names.some((m) => m.includes("HW_DMA"))).toBe(false);
    expect(names.some((m) => m.includes("HW_UNUSED"))).toBe(true);
  });
});

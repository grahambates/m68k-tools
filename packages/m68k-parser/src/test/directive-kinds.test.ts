import {
  isBlockDirective,
  isSectionDirective,
  sectionTypeNames,
} from "../directive-kinds.js";

describe("sectionTypeNames", () => {
  it("has each base kind with its memory suffixes", () => {
    for (const kind of ["code", "data", "bss", "text"])
      for (const suffix of ["", "_c", "_f", "_p"])
        expect(sectionTypeNames).toContain(`${kind}${suffix}`);
  });

  it("has the older spellings", () => {
    expect(sectionTypeNames).toContain("cseg");
    expect(sectionTypeNames).toContain("dseg");
  });
});

describe("isSectionDirective", () => {
  it("is true for section and the bare kinds", () => {
    for (const name of ["section", "code", "DATA", "bss", "text", "cseg"])
      expect(isSectionDirective(name)).toBe(true);
  });

  it("is false for anything else", () => {
    for (const name of ["org", "dc", "even", "macro"])
      expect(isSectionDirective(name)).toBe(false);
  });
});

describe("isBlockDirective", () => {
  it("covers openers, alternatives and terminators", () => {
    for (const name of [
      "macro",
      "endm",
      "rept",
      "endr",
      "if",
      "IFEQ",
      "ifd",
      "else",
      "elseif",
      "endc",
      "endif",
    ])
      expect(isBlockDirective(name)).toBe(true);
  });

  it("is false for directives that stand alone", () => {
    for (const name of ["dc", "equ", "section", "include", "iif"])
      expect(isBlockDirective(name)).toBe(false);
  });
});

import { defaultConfig, type LintConfig } from "../core/config.js";
import { applyFixes } from "../core/fix.js";
import { lintSource } from "../core/lint.js";
import { fixture, lint } from "./helpers.js";

const RULE = "correctness/amiga-cross-section-pc-relative";
const amiga: LintConfig = {
  ...defaultConfig,
  platform: "amiga",
  measureImpact: false,
};

const findings = (source: string, config: LintConfig = amiga) =>
  lint(source, config).filter((d) => d.ruleId === RULE);

/** The lines flagged, 1-based, for compact assertions. */
const flagged = (source: string) => findings(source).map((d) => d.loc.line);

// Checked with vasm 2.0 (mot syntax 3.19) writing a hunk executable
// (-Fhunkexe): every flagged reference is one vasm rejects with "reloc type 2
// ... not supported", and every "same section" case assembles. The "stays
// silent" cases are ones this file cannot settle, so some are misses by design:
// vasm rejects the numeric memory attribute case, for one.
describe("cross-section PC-relative references", () => {
  test("flags a reference from code to a data section", () => {
    const [d] = findings(
      [
        "\tsection a,code",
        "\tmove.l var(pc),d0",
        "\tsection b,data",
        "var:\tdc.l 1",
      ].join("\n"),
    );
    expect(d).toMatchObject({
      severity: "error",
      confidence: "certain",
      message: "PC-relative reference to var in another section",
      suggestion: { replacement: "\tmove.l var,d0", applicability: "safe" },
    });
  });

  test("keeps an offset and the operand's other text in the fix", () => {
    const [d] = findings(
      [
        "\tsection a,code",
        "\tlea\t(var+2)(pc),a0 ; comment",
        "\tsection b,bss",
        "var:\tds.l 1",
      ].join("\n"),
    );
    expect(d?.suggestion?.replacement).toBe("\tlea\t(var+2),a0 ; comment");
  });

  test("the fix removes the finding", () => {
    const source = fixture(
      [
        "\tsection a,code",
        "\tlea (var,pc),a0",
        "\tsection b,data",
        "var:\tdc.w 0",
      ].join("\n"),
    );
    const result = applyFixes(source, (s) => lintSource(s, amiga), {
      accept: ["safe"],
    });
    expect(result.output).toContain("\tlea var,a0");
    expect(
      lintSource(result.output, amiga).filter((d) => d.ruleId === RULE),
    ).toEqual([]);
  });

  test("a reference between two code sections depends on small code", () => {
    const [d] = findings(
      [
        "\tsection a,code",
        "\tjsr sub(pc)",
        "\tsection b,code",
        "sub:\trts",
      ].join("\n"),
    );
    expect(d).toMatchObject({
      confidence: "high",
      suggestion: { applicability: "conditional" },
    });
    expect(d?.notes?.map((n) => n.message).join(" ")).toContain("-sc");
  });

  test("an indexed reference is reported without an automatic fix", () => {
    const [d] = findings(
      [
        "\tsection a,code",
        "\tmove.w tab(pc,d0.w),d1",
        "\tsection b,data",
        "tab:\tdc.w 1",
      ].join("\n"),
    );
    expect(d?.suggestion).toMatchObject({ applicability: "manual" });
    expect(d?.suggestion?.replacement).toBeUndefined();
  });

  test("a local label is resolved in its own scope", () => {
    expect(
      flagged(
        [
          "\tsection a,code",
          "f:\tlea .v(pc),a0",
          "\tsection b,data",
          ".v:\tdc.w 0",
        ].join("\n"),
      ),
    ).toEqual([2]);
  });

  test("names are compared exactly, with the type part of the identity", () => {
    // `a` and `A` are different sections; so are `a,code` and `a,data`.
    expect(
      flagged(
        [
          "\tsection a,code",
          "\tlea v(pc),a0",
          "\tsection A,code",
          "v:\tdc.w 0",
        ].join("\n"),
      ),
    ).toEqual([2]);
    expect(
      flagged(
        [
          "\tsection a,code",
          "\tlea v(pc),a0",
          "\tsection a,data",
          "v:\tdc.w 0",
        ].join("\n"),
      ),
    ).toEqual([2]);
  });

  test("the memory attribute is part of the identity", () => {
    expect(
      flagged(
        [
          "\tsection a,data",
          "\tlea v(pc),a0",
          "\tsection a,data_c",
          "v:\tdc.w 0",
        ].join("\n"),
      ),
    ).toEqual([2]);
  });

  test.each([
    [
      "a section reopened by name",
      "\tsection a,code\n\tlea v(pc),a0\n\tsection b,data\n\tdc.w 0\n\tsection a,code\nv:\tdc.w 0",
    ],
    ["text and code", "\ttext\n\tlea v(pc),a0\n\tcode\nv:\tdc.w 0"],
    [
      "code and section .text,code",
      "\tcode\n\tlea v(pc),a0\n\tsection .text,code\nv:\tdc.w 0",
    ],
    ["the default section and code", "\tlea v(pc),a0\n\tcode\nv:\tdc.w 0"],
    [
      "a section type in capitals",
      "\tsection a,code\n\tlea v(pc),a0\n\tsection a,CODE\nv:\tdc.w 0",
    ],
    [
      "a suffix and a memory operand",
      "\tsection a,code_c\n\tlea v(pc),a0\n\tsection a,code,chip\nv:\tdc.w 0",
    ],
    [
      "pushsection and popsection",
      "\tsection a,code\n\tlea v(pc),a0\n\tpushsection\n\tsection b,data\nw:\tdc.w 0\n\tpopsection\nv:\tdc.w 0",
    ],
  ])("accepts the same section: %s", (_, source) => {
    expect(flagged(source)).toEqual([]);
  });

  test.each([
    [
      "the difference of two labels",
      "\tsection a,code\n\tlea v-w(pc),a0\n\tsection b,data\nv:\tdc.w 0\nw:\tdc.w 0",
    ],
    [
      "an RS offset",
      "\tsection a,code\n\tlea v(pc),a0\n\tsection b,data\n\trsreset\nv\trs.w 1",
    ],
    [
      "a label in an OFFSET block",
      "\tsection a,code\n\tlea v(pc),a0\n\toffset 0\nv:\tds.w 1",
    ],
    [
      "a label after ORG",
      "\tsection a,code\n\tlea v(pc),a0\n\torg $1000\nv:\tdc.w 0",
    ],
    ["a label defined elsewhere", "\tsection a,code\n\tlea v(pc),a0"],
  ])("ignores what is not a cross-section label: %s", (_, source) => {
    expect(flagged(source)).toEqual([]);
  });

  test.each([
    [
      "an INCLUDE",
      '\tsection a,code\n\tinclude "x.i"\n\tlea v(pc),a0\n\tsection b,data\nv:\tdc.w 0',
    ],
    [
      "a macro this file cannot see into",
      "\tsection a,code\n\tSWITCH\n\tlea v(pc),a0\n\tsection b,data\nv:\tdc.w 0",
    ],
    [
      "a macro that changes section",
      "SWITCH:\tmacro\n\tsection b,data\n\tendm\n\tsection a,code\n\tSWITCH\n\tlea v(pc),a0\n\tsection b,data\nv:\tdc.w 0",
    ],
    [
      "an undecided conditional whose arms differ",
      "\tsection a,code\n\tifd FOO\n\tsection b,data\n\tendc\n\tlea v(pc),a0\n\tsection b,data\nv:\tdc.w 0",
    ],
    [
      "an unreadable section name",
      "\tsection a,code\n\tlea v(pc),a0\n\tsection b,data,$40000\nv:\tdc.w 0",
    ],
  ])("stays silent once the section is unknown: %s", (_, source) => {
    expect(flagged(source)).toEqual([]);
  });

  test("a local macro that stays in its section keeps the section known", () => {
    expect(
      flagged(
        [
          "WAIT:\tmacro",
          ".w:\tbtst #6,$dff002",
          "\tbne.s .w",
          "\tendm",
          "\tsection a,code",
          "\tWAIT",
          "\tlea v(pc),a0",
          "\tsection b,data",
          "v:\tdc.w 0",
        ].join("\n"),
      ),
    ).toEqual([7]);
  });

  test("an undecided conditional whose arms agree keeps the section", () => {
    expect(
      flagged(
        [
          "\tsection a,code",
          "\tifd FOO",
          "\tnop",
          "\telse",
          "\tsection b,data",
          "\tsection a,code",
          "\tendc",
          "\tlea v(pc),a0",
          "\tsection b,data",
          "v:\tdc.w 0",
        ].join("\n"),
      ),
    ).toEqual([8]);
  });

  test("runs only for Amiga", () => {
    const source =
      "\tsection a,code\n\tlea v(pc),a0\n\tsection b,data\nv:\tdc.w 0";
    // TOS places data straight after text, so vasm resolves the distance.
    expect(findings(source, { ...amiga, platform: "atari" })).toEqual([]);
    expect(findings(source, { ...amiga, platform: "generic" })).toEqual([]);
  });
});

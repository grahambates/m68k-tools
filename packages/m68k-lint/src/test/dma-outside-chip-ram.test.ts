import { defaultConfig, type LintConfig } from "../core/config.js";
import { lint } from "./helpers.js";

const RULE = "correctness/amiga-dma-outside-chip-ram";
const amiga: LintConfig = {
  ...defaultConfig,
  platform: "amiga",
  measureImpact: false,
};

const findings = (source: string, config: LintConfig = amiga) =>
  lint(source, config).filter((d) => d.ruleId === RULE);

/** Code writing a pointer, then `copper` defined in the given section. */
const program = (code: string[], section = "\tsection data,data") =>
  [
    "\tsection code,code",
    "\tlea $dff000,a6",
    ...code,
    "\trts",
    section,
    "copper:\tdc.w $ffff,$fffe",
  ].join("\n");

describe("DMA pointers outside chip RAM", () => {
  test("a pointer written with a label's address as an immediate", () => {
    const [d] = findings(program(["\tmove.l #copper,$dff080"]));
    expect(d).toMatchObject({
      severity: "error",
      confidence: "high",
      message: "COP1LC is set to copper, which is not in chip RAM",
      suggestion: {
        applicability: "manual",
        description: expect.stringContaining(
          "such as data_c (the data section opens on line 5)",
        ),
      },
    });
  });

  test.each([
    ["COP1LC(a6)", "COP1LC"],
    ["$80(a6)", "COP1LC"],
    ["COP2LC(a6)", "COP2LC"],
    ["AUD3LC(a6)", "AUD3LC"],
    ["BLTAPT(a6)", "BLTAPT"],
    ["BLTDPT(a6)", "BLTDPT"],
    ["BPL6PT(a6)", "BPL6PT"],
    ["SPR7PT(a6)", "SPR7PT"],
    ["DSKPT(a6)", "DSKPT"],
    ["CUSTOM+COP1LC", "COP1LC"],
  ])("recognises %s as %s", (destination, name) => {
    const [d] = findings(program([`\tmove.l #copper,${destination}`]));
    expect(d?.message).toBe(
      `${name} is set to copper, which is not in chip RAM`,
    );
  });

  test.each([
    ["lea", ["\tlea copper,a0", "\tmove.l a0,COP1LC(a6)"]],
    ["lea (pc)", ["\tlea copper+4(pc),a0", "\tmove.l a0,COP1LC(a6)"]],
    ["move.l #", ["\tmove.l #copper,d0", "\tmove.l d0,COP1LC(a6)"]],
    [
      "a copy between registers",
      ["\tlea copper,a1", "\tmove.l a1,d2", "\tmove.l d2,COP1LC(a6)"],
    ],
    [
      "unrelated code in between",
      [
        "\tlea copper,a0",
        "\tmoveq #0,d0",
        "\tmove.w d0,$dff088",
        "\tmove.l a0,COP1LC(a6)",
      ],
    ],
  ])("follows a label loaded with %s", (_, code) => {
    const [d] = findings(program(code));
    expect(d?.notes?.at(-1)).toMatchObject({
      message: "copper is loaded here.",
    });
  });

  test("a label reaching the write along one path of several", () => {
    expect(
      findings(
        program([
          "\ttst.w d0",
          "\tbeq.s .other",
          "\tlea copper,a0",
          "\tbra.s .set",
          ".other:",
          "\tmove.l (a1),a0",
          ".set:",
          "\tmove.l a0,COP1LC(a6)",
        ]),
      ),
    ).toHaveLength(1);
  });

  test("an explicitly fast section is certain", () => {
    const [d] = findings(
      program(["\tmove.l #copper,COP1LC(a6)"], "\tsection vars,data_f"),
    );
    expect(d).toMatchObject({ confidence: "certain" });
    expect(d?.suggestion?.description).toContain("such as section vars,data_c");
  });

  test.each([
    ["data_c", "\tdata_c"],
    ["bss_c", "\tbss_c"],
    ["a _c type", "\tsection gfx,data_c"],
    ["a chip attribute", "\tsection gfx,data,chip"],
  ])("accepts a label in chip RAM: %s", (_, section) => {
    expect(findings(program(["\tmove.l #copper,COP1LC(a6)"], section))).toEqual(
      [],
    );
  });

  test.each([
    [
      "an address from somewhere else",
      ["\tmove.l (a1),a0", "\tmove.l a0,COP1LC(a6)"],
    ],
    [
      "a register loaded before a call",
      ["\tlea copper,a0", "\tbsr sub", "\tmove.l a0,COP1LC(a6)"],
    ],
    [
      "a register loaded before an unknown macro",
      ["\tlea copper,a0", "\tWAITBLIT", "\tmove.l a0,COP1LC(a6)"],
    ],
    [
      "a register changed after the load",
      ["\tlea copper,a0", "\taddq.l #4,a0", "\tmove.l a0,COP1LC(a6)"],
    ],
    ["a word write of half a pointer", ["\tmove.w #copper,COP1LC+2(a6)"]],
    ["a register that is not a DMA pointer", ["\tmove.l #copper,BLTAFWM(a6)"]],
    ["a constant, not a label", ["\tmove.l #$70000,COP1LC(a6)"]],
  ])("stays silent for %s", (_, code) => {
    expect(findings(program([...code, "\trts", "sub:"]))).toEqual([]);
  });

  test("a label defined in an unknown section is not reported", () => {
    expect(
      findings(
        [
          "\tsection code,code",
          "\tmove.l #copper,$dff080",
          '\tinclude "copper.i"',
          "copper:\tdc.w $ffff,$fffe",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("runs only for Amiga", () => {
    const source = program(["\tmove.l #copper,$dff080"]);
    expect(findings(source, { ...amiga, platform: "generic" })).toEqual([]);
  });
});

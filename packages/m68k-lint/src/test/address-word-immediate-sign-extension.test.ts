import { lintSource } from "../core/lint.js";

/**
 * CMPA.W, ADDA.W and SUBA.W sign-extend their source, so a word immediate of
 * $8000 to $FFFF takes part as a negative value. Encodings checked against
 * vasm 2.0f with -no-opt: `cmpa.w #$8000,a0` is $B0FC $8000, compared as
 * $FFFF8000, and an unsized or generic spelling is the same word form.
 */
const ID = "suspicious/address-word-immediate-sign-extension";

const findings = (source: string) =>
  lintSource(source, { processors: ["mc68000"] }).filter(
    (d) => d.ruleId === ID,
  );

describe(ID, () => {
  test.each([
    ["\tcmpa.w #$C000,a0", "CMPA.W compares A0 with $FFFFC000, not $C000"],
    ["\tadda.w #$8000,a1", "ADDA.W adds $FFFF8000, not $8000, to A1"],
    ["\tsuba.w #$FFFF,a2", "SUBA.W subtracts $FFFFFFFF, not $FFFF, from A2"],
    // Unsized, and the generic spellings vasm assembles as the word forms.
    ["\tcmpa #$8000,a0", "CMPA.W compares A0 with $FFFF8000, not $8000"],
    ["\tcmp.w #$9000,a0", "CMPA.W compares A0 with $FFFF9000, not $9000"],
    ["\tadd #$8000,a0", "ADDA.W adds $FFFF8000, not $8000, to A0"],
  ])("reports %s", (source, message) => {
    expect(findings(source).map((d) => d.message)).toEqual([message]);
  });

  test("evaluates a constant", () => {
    expect(findings("LIMIT equ $A000\n\tcmpa.w #LIMIT,a3")).toHaveLength(1);
  });

  test.each([
    ["\tcmpa.w #$7FFF,a0", "fits below $8000"],
    ["\tcmpa.w #-1,a0", "already negative"],
    ["\tadda.w #-$8000,a0", "already negative"],
    ["\tcmpa.l #$C000,a0", "long"],
    ["\tmovea.w #$8000,a0", "MOVEA has its own rule"],
    ["\tcmp.w #$C000,d0", "not an address register"],
    ["\tcmpa.w d0,a0", "not an immediate"],
    ["\tcmpa.w #UNKNOWN,a0", "unknown value"],
  ])("leaves %s alone (%s)", (source) => {
    expect(findings(source)).toEqual([]);
  });

  test("explains what vasm's optimiser makes of SUBA.W #$8000", () => {
    const [finding] = findings("\tsuba.w #$8000,a0");
    expect(finding.notes?.map((n) => n.message)).toContain(
      "vasm's optimiser reads the value as written and assembles this as LEA -32768(An), which subtracts 32768; the instruction itself adds it.",
    );
  });
});

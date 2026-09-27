import { defaultConfig, type LintConfig } from "../core/config.js";
import { lint } from "./helpers.js";

const RULE = "suspicious/fallthrough-into-data";
const config: LintConfig = { ...defaultConfig, measureImpact: false };

const findings = (source: string) =>
  lint(source, config).filter((d) => d.ruleId === RULE);

/** The lines flagged, 1-based. */
const flagged = (source: string) => findings(source).map((d) => d.loc.line);

/** A routine ending in `last`, with `data` straight after it. */
const routine = (last: string[], data = 'message:\tdc.b "hello",0') =>
  ["start:", "\tmoveq #0,d0", ...last, data].join("\n");

describe("code running on into data", () => {
  test("reports falling into byte data", () => {
    const [d] = findings(routine(["\tmove.w d0,d1"]));
    expect(d).toMatchObject({
      severity: "warning",
      confidence: "high",
      message: "Execution can run on into the data at message",
      loc: { line: 3 },
    });
    expect(d?.notes).toHaveLength(1);
  });

  test.each([
    ["ds", "buffer:\tds.b 64"],
    ["dcb", "fill:\tdcb.b 8,0"],
    ["incbin", 'image:\tincbin "image.raw"'],
  ])("reports falling into %s", (_, data) => {
    expect(flagged(routine(["\tnop"], data))).toEqual([3]);
  });

  test.each([
    ["dc.w", "\tdc.w $4e71"],
    ["dc.l", "\tdc.l 0"],
    ["dc with no size, which is a word", "\tdc 1"],
  ])("falling into %s may be code written by hand", (_, data) => {
    const [d] = findings(routine(["\tnop"], data));
    expect(d).toMatchObject({
      confidence: "low",
      message: "Execution can run on into the data that follows",
    });
    expect(d?.notes?.[1]?.message).toContain(
      "m68k-lint-disable-line suspicious/fallthrough-into-data",
    );
  });

  test.each([
    ["a conditional branch", "\tbne start"],
    ["DBcc", "\tdbf d0,start"],
  ])("%s can fall into the data", (_, last) => {
    expect(flagged(routine([last]))).toEqual([3]);
  });

  test("labels, comments and alignment are passed over", () => {
    expect(
      flagged(routine(["\tnop", "; strings", "\teven", "size\tequ 4"])),
    ).toEqual([3]);
  });

  test.each([
    ["RTS", "\trts"],
    ["BRA", "\tbra start"],
    ["JMP", "\tjmp (a0)"],
    ["ILLEGAL", "\tillegal"],
    ["a TRAP, which may be how the program exits", "\ttrap #1"],
    ["a line made conditional by IIF", "\tiif 1 rts"],
    ["a macro it cannot see into", "\tEXIT"],
  ])("stays silent after %s", (_, last) => {
    expect(flagged(routine([last]))).toEqual([]);
  });

  test("a call followed by inline data is the inline-argument idiom", () => {
    expect(flagged(routine(["\tbsr print"]))).toEqual([]);
    expect(flagged(routine(["\tjsr print"]))).toEqual([]);
  });

  test("data in another section is the section rule's concern", () => {
    expect(
      flagged(routine(["\tnop", "\tsection vars,data"], "value:\tdc.w 0")),
    ).toEqual([]);
    expect(
      flagged(routine(["\tnop", '\tinclude "data.i"'], "value:\tdc.w 0")),
    ).toEqual([]);
  });

  test("unreachable code is left to the unreachable-code rule", () => {
    expect(flagged(routine(["\trts", "\tnop"]))).toEqual([]);
  });

  test("works with no section directive at all, after an include", () => {
    expect(
      flagged(['\tinclude "hardware/custom.i"', routine(["\tnop"])].join("\n")),
    ).toEqual([4]);
  });
});

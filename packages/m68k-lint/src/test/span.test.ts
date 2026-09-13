import { parseFile } from "m68k-parser";
import { lintSource } from "../core/lint.js";
import { computeSourceSpan } from "../core/span.js";
import type { Diagnostic } from "../core/diagnostic.js";

/**
 * A finding covers a run of lines, and a suggestion's replacement stands in for
 * that whole run: BSR followed by RTS becomes one BRA. The extent used to be
 * reconstructed inside the impact module by reading `data` key names, so it
 * existed only where measurement ran. Anything applying a replacement needs it
 * unconditionally.
 */
const find = (lines: string[], ruleId: string) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] }).find(
    (d) => d.ruleId === ruleId,
  );

describe("every diagnostic carries its extent", () => {
  test("a single-line finding spans one line", () => {
    const found = find(
      ["\tmove.l\t#100,d0", "\trts"],
      "optimization/prefer-moveq",
    );
    expect(found?.span).toEqual({ startLine: 1, endLine: 1 });
  });

  test("a two-instruction match spans both lines", () => {
    const found = find(
      ["\tbsr\t.sub", "\trts", ".sub:", "\trts"],
      "optimization/bsr-rts-tail-call",
    );
    expect(found?.span).toEqual({ startLine: 1, endLine: 2 });
  });

  test("a three-instruction match spans all three", () => {
    const found = find(
      [
        "\tmove.l\ta6,-(sp)",
        "\tmove.l\tsp,a6",
        "\tadd.w\t#-32,sp",
        "\tmoveq\t#0,d0",
        "\trts",
      ],
      "optimization/prefer-link-sequence",
    );
    expect(found?.span).toEqual({ startLine: 1, endLine: 3 });
  });

  test("the span is present without measurement having run", () => {
    const source = ["\tbsr\t.sub", "\trts", ".sub:", "\trts"].join("\n");
    const found = lintSource(source, {
      processors: ["mc68000"],
      measureImpact: false,
    }).find((d) => d.ruleId === "optimization/bsr-rts-tail-call");
    expect(found?.suggestion?.impact).toBeUndefined();
    expect(found?.span).toEqual({ startLine: 1, endLine: 2 });
  });

  test("it can be computed for a diagnostic built by hand", () => {
    const file = parseFile("\tmove.l #1,d0\n\trts");
    const diagnostic = {
      ruleId: "test/span",
      category: "optimization",
      severity: "suggestion",
      confidence: "certain",
      message: "test",
      loc: { line: 1, start: 1, end: 7 },
      data: { secondInstructionIndex: 1 },
    } as unknown as Diagnostic;
    expect(computeSourceSpan(diagnostic, file)).toEqual({
      startLine: 1,
      endLine: 2,
    });
  });
});

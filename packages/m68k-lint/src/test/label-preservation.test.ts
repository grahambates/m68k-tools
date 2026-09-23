import { lintSource } from "../core/lint.js";
import { findDiagnostic } from "./helpers.js";

/**
 * A replacement stands in for whole lines, so applying one destroys everything
 * on them that is not the instruction. A label is the case that breaks a build
 * rather than merely losing information: `start: move.l #100,d0` becoming
 * `moveq #100,d0` was a `safe` suggestion that deleted `start:` and with it
 * every branch to it.
 *
 * A label on the first line still points at the same instruction, so it is
 * carried across. One further into the run has nowhere to go once the run
 * collapses, so there is no rewrite to offer.
 */
const suggestion = (lines: string[], ruleId: string) =>
  findDiagnostic(
    lintSource(lines.join("\n"), { processors: ["mc68000"] }),
    ruleId,
  )?.suggestion;

describe("a label on the first line is kept", () => {
  test("through a one-for-one replacement", () => {
    expect(
      suggestion(
        ["start:\tmove.l\t#100,d0", "\trts"],
        "optimization/prefer-moveq",
      )?.replacement,
    ).toBe("start:\tmoveq\t#100,d0");
  });

  test("on the first line of a multi-line replacement", () => {
    const found = suggestion(
      ["start:\tmuls.w\t#10,d0", "\tmove.l\td1,d2", "\trts"],
      "optimization/muls-word-selected-constants",
    );
    expect(found?.replacement?.split("\n")[0]).toBe("start:\text.l\td0");
  });

  // Deleting the instruction still leaves somewhere to branch to.
  test("when the instruction is deleted outright", () => {
    const found = suggestion(
      [
        "start:\tmove.w\t#100,d0",
        "\tmove.w\t#200,d0",
        "\tmove.l\td0,(a0)",
        "\trts",
      ],
      "suspicious/dead-register-write",
    );
    expect(found?.replacement).toBe("start:");
    expect(found?.applicability).toBe("safe");
  });

  test("a label on its own line above is outside the match and untouched", () => {
    expect(
      suggestion(
        ["start:", "\tmove.l\t#100,d0", "\trts"],
        "optimization/prefer-moveq",
      )?.replacement,
    ).toBe("\tmoveq\t#100,d0");
  });
});

describe("a label further into the match leaves nothing to offer", () => {
  const LINK = "optimization/prefer-link-sequence";

  test("sharing a line with an interior instruction", () => {
    const found = suggestion(
      [
        "\tmove.l\ta6,-(sp)",
        ".ret:\tmove.l\tsp,a6",
        "\tadd.w\t#-32,sp",
        "\tmoveq\t#0,d0",
        "\trts",
      ],
      LINK,
    );
    expect(found?.replacement).toBeUndefined();
    expect(found?.applicability).toBe("manual");
  });

  test("on its own line inside the match", () => {
    const found = suggestion(
      [
        "\tmove.l\ta6,-(sp)",
        ".ret:",
        "\tmove.l\tsp,a6",
        "\tadd.w\t#-32,sp",
        "\tmoveq\t#0,d0",
        "\trts",
      ],
      LINK,
    );
    expect(found?.replacement).toBeUndefined();
    expect(found?.applicability).toBe("manual");
  });

  test("the same match without a label is still offered", () => {
    const found = suggestion(
      [
        "\tmove.l\ta6,-(sp)",
        "\tmove.l\tsp,a6",
        "\tadd.w\t#-32,sp",
        "\tmoveq\t#0,d0",
        "\trts",
      ],
      LINK,
    );
    expect(found?.replacement).toBe("\tlink\ta6,#-32");
  });
});

/**
 * A comment is often the only record of why the code is the way it is, so
 * applying a replacement must not quietly throw it away. Unlike a label,
 * dropping one breaks nothing, which is why it was the lesser half of the
 * problem — but it is still the author's work.
 */
describe("trailing comments survive the replacement", () => {
  test("carried across a one-for-one rewrite, spacing and all", () => {
    expect(
      suggestion(
        ["\tmove.l\t#100,d0\t; how many faces", "\trts"],
        "optimization/prefer-moveq",
      )?.replacement,
    ).toBe("\tmoveq\t#100,d0\t; how many faces");
  });

  test("alongside a label on the same line", () => {
    expect(
      suggestion(
        ["start:\tmove.l\t#100,d0\t; go", "\trts"],
        "optimization/prefer-moveq",
      )?.replacement,
    ).toBe("start:\tmoveq\t#100,d0\t; go");
  });

  // The comment describes the operation, which is now the whole block.
  test("placed on the first line where one instruction becomes several", () => {
    const found = suggestion(
      ["\tmuls.w\t#10,d0\t; scale up", "\tmove.l\td1,d2", "\trts"],
      "optimization/muls-word-selected-constants",
    );
    expect(found?.replacement?.split("\n")[0]).toBe("\text.l\td0\t; scale up");
  });

  // Nothing is left for these to sit beside, so they are kept on their own
  // rather than dropped, indented to match the code they came from.
  test("kept when the lines they sat on collapse", () => {
    const found = suggestion(
      [
        "\tmove.l\ta6,-(sp)\t; save frame",
        "\tmove.l\tsp,a6",
        "\tadd.w\t#-32,sp\t; locals",
        "\tmoveq\t#0,d0",
        "\trts",
      ],
      "optimization/prefer-link-sequence",
    );
    expect(found?.replacement).toBe(
      "\tlink\ta6,#-32\t; save frame\n\t; locals",
    );
  });

  test("kept when the instruction is deleted, with its label", () => {
    const found = suggestion(
      [
        "start:\tmove.w\t#100,d0\t; unused",
        "\tmove.w\t#200,d0",
        "\tmove.l\td0,(a0)",
        "\trts",
      ],
      "suspicious/dead-register-write",
    );
    expect(found?.replacement).toBe("start:\t; unused");
  });

  test("an uncommented line gains nothing", () => {
    expect(
      suggestion(["\tmove.l\t#100,d0", "\trts"], "optimization/prefer-moveq")
        ?.replacement,
    ).toBe("\tmoveq\t#100,d0");
  });

  test("comments do not disturb the measurement", () => {
    const commented = suggestion(
      ["\tmove.l\t#100,d0\t; note", "\trts"],
      "optimization/prefer-moveq",
    );
    const plain = suggestion(
      ["\tmove.l\t#100,d0", "\trts"],
      "optimization/prefer-moveq",
    );
    expect(commented?.impact?.sizeBytes?.delta).toBe(
      plain?.impact?.sizeBytes?.delta,
    );
    expect(commented?.impact?.execution?.cpuCycles?.delta).toBe(
      plain?.impact?.execution?.cpuCycles?.delta,
    );
  });
});

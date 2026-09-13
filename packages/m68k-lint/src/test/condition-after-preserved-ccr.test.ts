import { lintSource } from "../core/lint.js";

/**
 * The rule is about a condition surviving across an instruction that has
 * nothing to do with it, which is easy to break later by inserting something
 * that sets flags. An instruction that reads the condition codes is not that:
 * it is another consumer of the same test.
 *
 *     move.l  d0,dosHandle
 *     sne     isOS2
 *     bne.s   .dosOk
 *
 * Branches were already excluded, because they do not fall through. Scc does,
 * so the branch after one was reported.
 */
const fires = (lines: string[]) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] }).some(
    (d) => d.ruleId === "suspicious/condition-after-preserved-ccr",
  );

describe("one test may have several consumers", () => {
  test("Scc followed by a branch on the same condition", () => {
    expect(
      fires([
        "\tmove.l\td0,dosHandle",
        "\tsne\tisOS2",
        "\tbne.s\t.dosOk",
        ".dosOk:",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("a chain of them", () => {
    expect(
      fires([
        "\ttst.l\td0",
        "\tsne\td1",
        "\tseq\td2",
        "\tbne.s\t.a",
        ".a:",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("two branches on one test", () => {
    expect(
      fires([
        "\ttst.l\td0",
        "\tbeq.s\t.a",
        "\tbne.s\t.b",
        ".a:",
        ".b:",
        "\trts",
      ]),
    ).toBe(false);
  });
});

describe("a condition surviving unrelated code is still reported", () => {
  test("a branch after a flag-preserving move", () => {
    expect(
      fires(["\ttst.l\td0", "\tmove.l\ta0,a1", "\tbeq.s\t.a", ".a:", "\trts"]),
    ).toBe(true);
  });

  // The exemption is for the instruction in between, not for Scc itself.
  test("an Scc after a flag-preserving instruction", () => {
    expect(
      fires(["\ttst.l\td0", "\tlea\t4(a0),a0", "\tsne\td1", "\trts"]),
    ).toBe(true);
  });
});

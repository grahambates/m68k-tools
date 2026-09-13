import { lintSource } from "../core/lint.js";

/**
 * Building a long out of its halves is ordinary assembly: a word into the low
 * half, a SWAP, a word into the other. Every write in that pattern is partial,
 * so on its own each one looks like it inherited whatever was above it, and the
 * rule fired all over real source.
 *
 * What separates construction from an oversight is whether the routine ever
 * takes charge of the whole register — a MOVE.L, a CLR.L, a MOVEQ, a SWAP.
 * Where it does, both halves are accounted for.
 */
const fires = (lines: string[]) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] }).some(
    (d) => d.ruleId === "suspicious/partial-register-write",
  );

describe("a routine that writes the register whole is building a value", () => {
  test("halves assembled around a SWAP", () => {
    expect(
      fires([
        "Routine:",
        "\tmove.w\t#1,d0",
        "\tswap\td0",
        "\tmove.w\t#2,d0",
        "\tmove.l\td0,(a0)",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("a long move establishes the upper bits, whatever they hold", () => {
    expect(
      fires([
        "Routine:",
        "\tmove.l\td1,d7",
        "\tmove.w\td4,d7",
        "\tmove.l\td7,(a0)",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("the MOVEQ zero-extension idiom", () => {
    expect(
      fires([
        "Routine:",
        "\tmoveq\t#0,d2",
        "\tmove.b\t(a2),d2",
        "\tmove.l\td2,(a0)",
        "\trts",
      ]),
    ).toBe(false);
  });

  // Anywhere in the routine counts, not only before the narrow write.
  test("a full write later in the routine still counts", () => {
    expect(
      fires([
        "Routine:",
        "\tmove.w\td4,d7",
        "\tmove.l\td7,(a0)",
        "\tmove.l\t#0,d7",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("a local label does not start a new routine", () => {
    const source = [
      "Routine:",
      "\tmove.l\td1,d7",
      ".loop:",
      "\tmove.w\td4,d7",
      "\tmove.l\td7,(a0)",
      "\tdbf\td6,.loop",
      "\trts",
    ];
    expect(fires(source)).toBe(false);
  });
});

describe("bits nothing in the routine ever writes", () => {
  test("are still reported", () => {
    expect(
      fires(["Routine:", "\tmove.w\td4,d7", "\tmove.l\td7,(a0)", "\trts"]),
    ).toBe(true);
  });

  // A global label starts a new routine, so what happens in another one says
  // nothing about this one.
  test("a full write in a different routine does not excuse it", () => {
    const source = [
      "Other:",
      "\tmove.l\t#0,d7",
      "\trts",
      "Routine:",
      "\tmove.w\td4,d7",
      "\tmove.l\td7,(a0)",
      "\trts",
    ];
    expect(fires(source)).toBe(true);
  });
});

/**
 * The word forms of divide and multiply are not symmetric, and the difference
 * is the whole point of this rule.
 *
 * DIVU.W and DIVS.W take a **32-bit** dividend: the `.w` names the divisor and
 * the quotient. Dividing after setting only the low word reads whatever was
 * above it, which is the classic way to get a wrong answer.
 *
 * MULU.W and MULS.W read only the low word and write all 32, so setting just
 * the low word first is correct and says nothing.
 */
const divides = (lines: string[]) => fires(lines);

describe("DIVU and DIVS read a long dividend", () => {
  test("dividing after only the low word was set is reported", () => {
    expect(
      divides([
        "Routine:",
        "\tmove.w\t#100,d0",
        "\tdivu.w\t#4,d0",
        "\tmove.w\td0,(a0)",
        "\trts",
      ]),
    ).toBe(true);
  });

  test("the signed form too", () => {
    expect(
      divides([
        "Routine:",
        "\tmove.w\td4,d0",
        "\tdivs.w\t#4,d0",
        "\tmove.w\td0,(a0)",
        "\trts",
      ]),
    ).toBe(true);
  });

  test("establishing the long first is fine", () => {
    const source = [
      "Routine:",
      "\tmove.l\td1,d0",
      "\tmove.w\t#100,d0",
      "\tdivu.w\t#4,d0",
      "\tmove.w\td0,(a0)",
      "\trts",
    ];
    expect(divides(source)).toBe(false);
  });

  // The divide writes all 32 bits, but it consumed them first, so it does not
  // account for what was above the word that was set.
  test("the divide itself does not count as establishing the register", () => {
    const source = [
      "Routine:",
      "\tmove.w\t#100,d0",
      "\tdivu.w\t#4,d0",
      "\tmove.l\td0,(a0)",
      "\trts",
    ];
    expect(divides(source)).toBe(true);
  });
});

describe("MULU and MULS read only the low word", () => {
  test("multiplying after setting the low word says nothing", () => {
    expect(
      divides([
        "Routine:",
        "\tmove.w\t#100,d0",
        "\tmulu.w\t#4,d0",
        "\tmove.l\td0,(a0)",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("the signed form too", () => {
    expect(
      divides([
        "Routine:",
        "\tmove.w\td4,d0",
        "\tmuls.w\t#4,d0",
        "\tmove.l\td0,(a0)",
        "\trts",
      ]),
    ).toBe(false);
  });
});

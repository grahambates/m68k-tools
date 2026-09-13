import { parseFile } from "m68k-parser";
import { analyzeRegisters } from "../analysis/registers.js";
import { getRegisterSemantics } from "../semantics/registers.js";
import { lintSource } from "../core/lint.js";

/**
 * A byte or word operation on a data register leaves the bits above it in
 * place. Liveness treated every write as ending the life of the whole
 * register, so an instruction whose result survived only in the preserved half
 * looked dead:
 *
 *   swap    d7
 *   move.w  d4,d7      <- upper half of D7 is still the swapped-in value
 *   swap    d7
 */
const flagged = (lines: string[]) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] })
    .filter((d) => d.ruleId === "suspicious/dead-register-write")
    .map((d) => d.loc.line);

const semantics = (source: string) =>
  getRegisterSemantics(parseFile(source).lines[0]);

describe("narrow writes preserve the bits above them", () => {
  test("a word write to a data register is recorded as partial", () => {
    expect([...semantics("\tmove.w d4,d7").partialWrites]).toEqual(["d7"]);
    expect([...semantics("\tmove.b d5,d7").partialWrites]).toEqual(["d7"]);
    expect([...semantics("\tclr.w d7").partialWrites]).toEqual(["d7"]);
  });

  test("a long write is not partial", () => {
    expect([...semantics("\tmove.l d4,d7").partialWrites]).toEqual([]);
    expect([...semantics("\tswap d7").partialWrites]).toEqual([]);
  });

  // MOVEA sign-extends across the whole register, and the word multiplies and
  // divides produce a long result, so none of them preserve anything.
  test("word forms that still write the whole register are not partial", () => {
    expect([...semantics("\tmovea.w d4,a0").partialWrites]).toEqual([]);
    expect([...semantics("\tmulu.w d1,d0").partialWrites]).toEqual([]);
    expect([...semantics("\tdivu.w d1,d0").partialWrites]).toEqual([]);
  });

  test("EXT reads the value it extends", () => {
    // Grouped with CLR as write-only, which made whatever fed it look dead.
    expect([...semantics("\text.l d0").reads]).toEqual(["d0"]);
    expect([...semantics("\text.w d0").reads]).toEqual(["d0"]);
    expect([...semantics("\tclr.l d0").reads]).toEqual([]);
  });
});

describe("dead-register-write no longer reports preserved bits", () => {
  test("a value surviving in the upper half through a word write", () => {
    expect(
      flagged([
        "\tswap\td7",
        "\tmove.w\td4,d7",
        "\tswap\td7",
        "\tmove.l\td7,(a0)",
        "\trts",
      ]),
    ).toEqual([]);
  });

  test("a word load feeding a sign extension", () => {
    expect(
      flagged(["\tmove.w\td3,d0", "\text.l\td0", "\tmove.l\td0,(a1)", "\trts"]),
    ).toEqual([]);
  });

  test("the same shape inside a macro body", () => {
    const source = [
      "Emit\tmacro",
      "\tmove.w\t\\1,d0",
      "\text.l\td0",
      "\tmove.l\td0,(\\2+0)(a1)",
      "\tendm",
    ];
    expect(flagged(source)).toEqual([]);
  });

  test("a byte write does not bury the word write under it", () => {
    expect(
      flagged([
        "\tmove.w\td4,d7",
        "\tmove.b\td5,d7",
        "\tmove.l\td7,(a0)",
        "\trts",
      ]),
    ).toEqual([]);
  });

  test("CLR.W leaves the upper half alone", () => {
    expect(
      flagged([
        "\tswap\td7",
        "\tclr.w\td7",
        "\tswap\td7",
        "\tmove.l\td7,(a0)",
        "\trts",
      ]),
    ).toEqual([]);
  });
});

describe("writes that really are dead are still reported", () => {
  test("a full-width overwrite", () => {
    expect(
      flagged([
        "\tmove.l\t#1,d0",
        "\tmove.l\t#2,d0",
        "\tmove.l\td0,(a0)",
        "\trts",
      ]),
    ).toEqual([1]);
  });

  // The register stays live throughout, but the bits this instruction writes
  // are overwritten before anything reads them.
  test("a word write whose own bits are overwritten", () => {
    expect(
      flagged([
        "\tmove.w\td0,d1",
        "\tmove.w\td2,d1",
        "\tmove.w\td1,(a0)",
        "\trts",
      ]),
    ).toEqual([1]);
  });

  test("a byte write whose own bits are overwritten", () => {
    expect(
      flagged([
        "\tmove.b\td0,d1",
        "\tmove.b\td2,d1",
        "\tmove.b\td1,(a0)",
        "\trts",
      ]),
    ).toEqual([1]);
  });

  test("a word write replaced by a long write", () => {
    expect(
      flagged([
        "\tmove.w\td4,d7",
        "\tmove.l\t#2,d7",
        "\tmove.l\td7,(a0)",
        "\trts",
      ]),
    ).toEqual([1]);
  });
});

describe("bit-level liveness accounts for narrower writes", () => {
  const bitsAfter = (
    lines: string[],
    index: number,
    register: string,
    mask: number,
  ) =>
    analyzeRegisters(parseFile(lines.join("\n"))).registerBitsUseAfter(
      index,
      register,
      mask,
    );

  test("a word write ends the life of the word below it", () => {
    expect(
      bitsAfter(
        ["\tmove.w d0,d1", "\tmove.w d2,d1", "\tmove.w d1,(a0)", "\trts"],
        0,
        "d1",
        0xffff,
      ),
    ).toBe("unused");
  });

  test("bits a narrower write does not cover stay in the question", () => {
    expect(
      bitsAfter(
        ["\tmove.w d4,d7", "\tmove.b d5,d7", "\tmove.l d7,(a0)", "\trts"],
        0,
        "d7",
        0xffff,
      ),
    ).toBe("used");
  });

  test("a long straight-line path does not overflow the JavaScript call stack", () => {
    const lines = [
      "\tmove.w d0,d1",
      ...Array.from({ length: 6_000 }, () => "\tnop"),
      "\trts",
    ];
    expect(bitsAfter(lines, 0, "d1", 0xffff)).toBe("unknown");
  });
});

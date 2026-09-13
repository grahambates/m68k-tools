import { lintSource } from "../core/lint.js";

/**
 * MOVEA.W sign-extends its source into all 32 bits of the address register.
 * That only matters where the upper half is read again. Using a spare address
 * register to hold a 16-bit value when data registers run short is ordinary,
 * and reading it back with MOVE.W is unaffected by the extension, so reporting
 * every MOVEA.W buried the case that is actually wrong.
 */
const ID = "suspicious/movea-word-sign-extension";

const fires = (lines: string[]) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] }).some(
    (d) => d.ruleId === ID,
  );

describe("the extended half is observed", () => {
  test("dereferenced as an address", () => {
    expect(fires(["\tmovea.w\td0,a0", "\tmove.l\t(a0),d1", "\trts"])).toBe(
      true,
    );
  });

  test("through a displacement", () => {
    expect(fires(["\tmovea.w\td0,a0", "\tmove.w\t4(a0),d1", "\trts"])).toBe(
      true,
    );
  });

  test("through predecrement", () => {
    expect(fires(["\tmovea.w\td0,a0", "\tmove.b\td1,-(a0)", "\trts"])).toBe(
      true,
    );
  });

  test("read back at full width", () => {
    expect(fires(["\tmovea.w\td0,a0", "\tmove.l\ta0,d1", "\trts"])).toBe(true);
  });

  test("the generic MOVE.W spelling is the same instruction", () => {
    expect(fires(["\tmove.w\td0,a0", "\tmove.l\t(a0),d1", "\trts"])).toBe(true);
  });

  // ADDA keeps the dependence: the upper half of its result comes from the
  // upper half that went in, so an extension is still observable through it.
  test("surviving address arithmetic and then read as a long", () => {
    expect(
      fires([
        "\tmovea.w\td0,a0",
        "\tadda.w\td2,a0",
        "\tmove.l\ta0,d1",
        "\trts",
      ]),
    ).toBe(true);
  });
});

describe("the extended half is not observed", () => {
  test("holding a value and reading it back as a word", () => {
    expect(fires(["\tmovea.w\td0,a0", "\tmove.w\ta0,d1", "\trts"])).toBe(false);
  });

  // The low half of an ADDA result cannot depend on the half above it, so
  // reading the word back is still unaffected.
  test("word arithmetic, then read back as a word", () => {
    expect(
      fires([
        "\tmovea.w\td0,a0",
        "\tadda.w\td2,a0",
        "\tmove.w\ta0,d1",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("overwritten in full before any use", () => {
    expect(
      fires([
        "\tmovea.w\td0,a0",
        "\tmovea.l\td1,a0",
        "\tmove.l\t(a0),d2",
        "\trts",
      ]),
    ).toBe(false);
  });

  test("never used again", () => {
    expect(fires(["\tmovea.w\td0,a0", "\trts"])).toBe(false);
  });

  test("a long load is not a sign extension at all", () => {
    expect(fires(["\tmove.l\td0,a0", "\tmove.l\t(a0),d1", "\trts"])).toBe(
      false,
    );
  });
});

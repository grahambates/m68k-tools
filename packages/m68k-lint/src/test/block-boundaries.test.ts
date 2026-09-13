import { lintSource } from "../core/lint.js";

/**
 * A rule matching a run of instructions replaces every line between the first
 * and the last, so anything sitting in that gap is destroyed. Reported from
 * real source:
 *
 *     ifne    LIGHTS
 *     bsr     UpdateLightSpritePosition
 *     endc
 *     rts
 *
 * The tail-call rule paired the BSR with the RTS and offered a BRA covering all
 * three lines, deleting the ENDC so the file no longer assembled. The same scan
 * would pair a BSR in one arm of a conditional with an RTS in the other, which
 * never run together at all.
 */
const replacementFor = (lines: string[], ruleId: string) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] }).find(
    (d) => d.ruleId === ruleId,
  )?.suggestion?.replacement;

const TAIL = "optimization/bsr-rts-tail-call";

describe("a run of instructions does not cross a block boundary", () => {
  test("the reported case: ENDC between the pair", () => {
    expect(
      replacementFor(
        ["\tifne\tLIGHTS", "\tbsr\tUpd", "\tendc", "\trts", "Upd:", "\trts"],
        TAIL,
      ),
    ).toBeUndefined();
  });

  // Worse than deleting the ENDC: these never both execute.
  test("instructions in opposite arms are not a sequence", () => {
    const source = [
      "\tifne\tX",
      "\tbsr\tFoo",
      "\telse",
      "\trts",
      "\tendc",
      "\tnop",
      "Foo:",
      "\trts",
    ];
    expect(replacementFor(source, TAIL)).toBeUndefined();
  });

  test("a REPT boundary separates them too", () => {
    expect(
      replacementFor(["\tbsr\tFoo", "\tendr", "\trts", "Foo:", "\trts"], TAIL),
    ).toBeUndefined();
  });

  test("an adjacent pair still matches", () => {
    expect(replacementFor(["\tbsr\tFoo", "\trts", "Foo:", "\trts"], TAIL)).toBe(
      "\tbra\tFoo",
    );
  });

  // The optimisation is still available where it is genuinely a sequence.
  test("a pair wholly inside one arm still matches", () => {
    expect(
      replacementFor(
        ["\tifne\tX", "\tbsr\tFoo", "\trts", "\tendc", "Foo:", "\trts"],
        TAIL,
      ),
    ).toBe("\tbra\tFoo");
  });
});

describe("every sequence rule is protected, not just the tail call", () => {
  test("a frame setup split by a conditional", () => {
    const source = [
      "\tmove.l\ta6,-(sp)",
      "\tifne\tX",
      "\tmove.l\tsp,a6",
      "\tendc",
      "\tadd.w\t#-32,sp",
      "\tmoveq\t#0,d0",
      "\trts",
    ];
    expect(
      replacementFor(source, "optimization/prefer-link-sequence"),
    ).toBeUndefined();
  });

  test("the same frame setup intact", () => {
    const source = [
      "\tmove.l\ta6,-(sp)",
      "\tmove.l\tsp,a6",
      "\tadd.w\t#-32,sp",
      "\tmoveq\t#0,d0",
      "\trts",
    ];
    expect(replacementFor(source, "optimization/prefer-link-sequence")).toBe(
      "\tlink\ta6,#-32",
    );
  });

  test("two quick adds split by a conditional", () => {
    const source = [
      "\tifne\tX",
      "\taddq.l\t#3,d0",
      "\tendc",
      "\taddq.l\t#2,d0",
      "\tmoveq\t#0,d7",
      "\trts",
    ];
    expect(
      replacementFor(source, "optimization/combine-consecutive-addq"),
    ).toBeUndefined();
  });

  test("the same two adds intact", () => {
    const source = [
      "\taddq.l\t#3,d0",
      "\taddq.l\t#2,d0",
      "\tmoveq\t#0,d7",
      "\trts",
    ];
    expect(
      replacementFor(source, "optimization/combine-consecutive-addq"),
    ).toBe("\taddq.l\t#5,d0");
  });

  // Not a block boundary, so the match is allowed to form; the span check is
  // what refuses, because replacing the run would delete the alignment.
  test("a directive inside the span is not swallowed", () => {
    const source = [
      "\tneg.l\td0",
      "\teven",
      "\tsub.l\td0,d1",
      "\tmoveq\t#0,d0",
      "\trts",
    ];
    expect(
      replacementFor(source, "optimization/negate-sub-to-add"),
    ).toBeUndefined();
  });
});

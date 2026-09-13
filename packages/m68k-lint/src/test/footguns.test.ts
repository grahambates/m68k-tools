import { lintSource } from "../core/lint.js";

function ids(source: string): string[] {
  return lintSource(source).map((diagnostic) => diagnostic.ruleId);
}

describe("correctness and suspicious footgun rules", () => {
  test("flags zero-sized DS declarations", () => {
    const diagnostics = lintSource("item: ds.w 0\nnext: dc.w 1");
    const diagnostic = diagnostics.find(
      (d) => d.ruleId === "suspicious/zero-sized-storage",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain("zero elements");
  });

  test("does not flag non-zero DS declarations", () => {
    expect(ids("item: ds.w 4")).not.toContain("suspicious/zero-sized-storage");
  });

  test("flags a condition that intentionally crosses a CCR-preserving instruction", () => {
    const source = [
      "    cmp.w #0,d0",
      "    adda.w #4,a0",
      "    beq .done",
      "    moveq #1,d1",
      ".done:",
      "    rts",
    ].join("\n");
    expect(ids(source)).toContain("suspicious/condition-after-preserved-ccr");
    expect(ids(source)).not.toContain("suspicious/stale-condition-code");
  });

  test("stale unknown CCR remains owned by correctness rule, not suspicious preserved-CCR rule", () => {
    const source = [
      "    adda.w #4,a0",
      "    beq .done",
      ".done:",
      "    rts",
    ].join("\n");
    expect(ids(source)).toContain("suspicious/stale-condition-code");
    expect(ids(source)).not.toContain(
      "suspicious/condition-after-preserved-ccr",
    );
  });

  test("flags MOVEA.W sign extension where the extended half is used", () => {
    const ID = "suspicious/movea-word-sign-extension";
    const used = ["    move.w d0,a0", "    move.l (a0),d1", "    rts"].join(
      "\n",
    );
    expect(ids(used)).toContain(ID);

    // The spelling no longer matters: both forms are MOVEA.W.
    const explicit = [
      "    movea.w d0,a0",
      "    move.l (a0),d1",
      "    rts",
    ].join("\n");
    expect(ids(explicit)).toContain(ID);

    // Holding a 16-bit value in a spare address register and reading it back
    // as a word is unaffected by the extension.
    const wordOnly = ["    movea.w d0,a0", "    move.w a0,d1", "    rts"].join(
      "\n",
    );
    expect(ids(wordOnly)).not.toContain(ID);

    expect(ids("    move.l d0,a0")).not.toContain(ID);
  });

  test("flags immediate bit numbers that wrap for memory or data registers", () => {
    const memory = lintSource("    btst #8,(a0)").find(
      (d) => d.ruleId === "suspicious/bit-number-wraparound",
    );
    expect(memory?.message).toContain("bit 0");
    expect(ids("    bset #32,d0")).toContain(
      "suspicious/bit-number-wraparound",
    );
    expect(ids("    bset #7,(a0)")).not.toContain(
      "suspicious/bit-number-wraparound",
    );
    expect(ids("    bset #31,d0")).not.toContain(
      "suspicious/bit-number-wraparound",
    );
  });

  test("flags partial MOVE writes when preserved upper bits are later consumed", () => {
    const source = ["    move.b (a0),d0", "    move.l d0,d1", "    rts"].join(
      "\n",
    );
    expect(ids(source)).toContain("suspicious/partial-register-write");
  });

  test("does not flag partial MOVE when a full overwrite occurs before upper bits are used", () => {
    const source = [
      "    move.b (a0),d0",
      "    moveq #0,d0",
      "    move.l d0,d1",
      "    rts",
    ].join("\n");
    expect(ids(source)).not.toContain("suspicious/partial-register-write");
  });

  test("does not flag a narrow load into a register seeded with a known value", () => {
    // The standard zero-extension idiom: the preserved bits are the point.
    const source = [
      "    moveq #0,d2",
      "    move.b 0(a2,d1.w),d2",
      "    move.l d2,d3",
      "    rts",
    ].join("\n");
    expect(ids(source)).not.toContain("suspicious/partial-register-write");
  });

  test("the seed does not have to be the preceding instruction", () => {
    // Constant propagation supplies the value, so anything in between is fine.
    const source = [
      "    moveq #0,d2",
      "    move.l d3,d4",
      "    nop",
      "    move.b (a2),d2",
      "    move.l d2,d3",
      "    rts",
    ].join("\n");
    expect(ids(source)).not.toContain("suspicious/partial-register-write");
  });

  test("accepts any known seed, not just MOVEQ zero", () => {
    for (const seed of ["clr.l d2", "moveq #-1,d2", "move.l #$ff00,d2"]) {
      const source = [
        "    " + seed,
        "    move.b (a2),d2",
        "    move.l d2,d3",
        "    rts",
      ].join("\n");
      expect([
        seed,
        ids(source).includes("suspicious/partial-register-write"),
      ]).toEqual([seed, false]);
    }
  });

  // A long move into the register first is the author taking charge of the
  // upper bits, whatever they hold, so it counts as accounting for them.
  test("a long write in the routine accounts for the preserved bits", () => {
    const source = [
      "    move.l d5,d2",
      "    move.b (a2),d2",
      "    move.l d2,d3",
      "    rts",
    ].join("\n");
    expect(ids(source)).not.toContain("suspicious/partial-register-write");
  });

  // What matters is whether the bits hold something the author put there, not
  // whether one instruction wrote the register whole. Populating it across
  // several narrow writes is construction, and the preserved bits are the point.
  test("narrow writes that between them define the bits later read are allowed", () => {
    const composed = [
      "Routine:",
      "    move.w d3,d4",
      "    move.b d2,d4",
      "    and.w d6,d4",
      "    move.w d4,(a3)",
      "    rts",
    ];
    expect(ids(composed.join("\n"))).not.toContain(
      "suspicious/partial-register-write",
    );

    // The low byte and high byte used as two independent accumulators, which
    // is why the byte write preserves bits 8-15 on purpose.
    const accumulators = [
      "Routine:",
      "    move.w -$e(a4),d0",
      "    add.w -$5e(a6),d0",
      "    move.b -$e(a1),d0",
      "    add.b -$5e(a3),d0",
      "    add.w d7,d0",
      "    move.w d0,(a1)",
      "    rts",
    ];
    expect(ids(accumulators.join("\n"))).not.toContain(
      "suspicious/partial-register-write",
    );
  });

  test("still flags a read that reaches past what the narrow writes define", () => {
    // The pair defines the low word between them, but nothing defines bits
    // 16-31, and this reads the register as a long.
    const source = [
      "Routine:",
      "    move.w d3,d4",
      "    move.b d2,d4",
      "    move.l d4,(a3)",
      "    rts",
    ].join("\n");
    expect(ids(source)).toContain("suspicious/partial-register-write");

    // The shape this rule is really for: a word write feeding long arithmetic.
    const widened = [
      "Routine:",
      "    move.w d0,d1",
      "    add.l FaceMaskBuffer,d1",
      "    rts",
    ].join("\n");
    expect(ids(widened)).toContain("suspicious/partial-register-write");
  });

  test("still flags bits nothing in the routine ever writes", () => {
    const source = [
      "Routine:",
      "    move.b (a2),d2",
      "    move.l d2,d3",
      "    rts",
    ].join("\n");
    expect(ids(source)).toContain("suspicious/partial-register-write");
  });

  // EXT and EXTB name the width of their *result*, not of what they read:
  // EXT.W reads the low byte, EXT.L the low word, EXTB.L the low byte. Reading
  // them at the result width made the bits they are about to overwrite look
  // observed, which reported the ordinary sign-extension idiom as a footgun.
  test("does not flag a sign-extension that defines every bit later read", () => {
    const widened = [
      "Routine:",
      "    move.b (a0),d0",
      "    ext.w d0",
      "    muls.w #40,d0",
      "    move.w d0,(a1)",
      "    rts",
    ];
    expect(ids(widened.join("\n"))).not.toContain(
      "suspicious/partial-register-write",
    );

    for (const extend of ["extb.l d0", "ext.l d0"]) {
      const load = extend === "ext.l d0" ? "move.w (a0),d0" : "move.b (a0),d0";
      const source = [
        "Routine:",
        `    ${load}`,
        `    ${extend}`,
        "    move.l d0,d1",
        "    rts",
      ].join("\n");
      expect([
        extend,
        ids(source).includes("suspicious/partial-register-write"),
      ]).toEqual([extend, false]);
    }
  });

  test("still flags bits the extension does not reach", () => {
    // EXT.W defines bits 8-15 and no further, so reading the register as a
    // long afterwards still observes whatever bits 16-31 held on entry. This
    // is the footgun, not a false positive: the fix narrows what EXT is taken
    // to read, it does not excuse the register.
    const source = [
      "Routine:",
      "    move.b (a0),d0",
      "    ext.w d0",
      "    move.l d0,d1",
      "    rts",
    ].join("\n");
    expect(ids(source)).toContain("suspicious/partial-register-write");
  });
});

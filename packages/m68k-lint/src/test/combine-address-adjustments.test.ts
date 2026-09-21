import { lint } from "./helpers.js";

/**
 * Consecutive constant adjustments of one address register fold into a single
 * ADDQ, SUBQ or LEA. Address registers have no condition codes, so only the
 * total matters. The folds below were also checked against Musashi (68000) on
 * random and boundary register values, comparing every register and the
 * memory written.
 */
const ID = "optimization/combine-address-adjustments";

const replacement = (source: string, config?: Parameters<typeof lint>[1]) =>
  lint(source, config).find((d) => d.ruleId === ID)?.suggestion?.replacement;

const fires = (source: string) => lint(source).some((d) => d.ruleId === ID);

describe("folds into one instruction", () => {
  test("two LEAs onto the same register", () => {
    expect(replacement("lea 32(a0),a0\nlea 32(a0),a0\nmove.l d0,(a0)")).toBe(
      "\tlea 64(a0),a0",
    );
  });

  test("a LEA and a SUBQ", () => {
    expect(replacement("lea 100(a0),a0\nsubq.l #4,a0\nmove.l d0,(a0)")).toBe(
      "\tlea 96(a0),a0",
    );
  });

  test("an ADDQ and a LEA that stay within quick range", () => {
    expect(replacement("addq.l #4,a0\nlea 4(a0),a0\nmove.l d0,(a0)")).toBe(
      "\taddq.l #8,a0",
    );
  });

  test("opposite quick adjustments leave the net one", () => {
    expect(replacement("addq.l #2,a1\nsubq.l #6,a1\nmove.l d0,(a1)")).toBe(
      "\tsubq.l #4,a1",
    );
  });

  test("ADDA.W and SUBA.W with immediates", () => {
    expect(replacement("suba.w #9,a1\naddq.w #4,a1\nmove.l d0,(a1)")).toBe(
      "\tsubq.l #5,a1",
    );
  });

  test("two ADDQs whose sum leaves quick range become a LEA", () => {
    // combine-consecutive-addq offers no fold here on a 68000, because a full
    // ADD.L is no faster than the pair. LEA is.
    expect(replacement("addq.l #8,a0\naddq.l #8,a0\nmove.l d0,(a0)")).toBe(
      "\tlea 16(a0),a0",
    );
  });

  test("sp and a7 are the same register", () => {
    expect(replacement("lea 8(sp),sp\nlea 8(a7),a7\nrts")).toBe(
      "\tlea 16(sp),sp",
    );
  });

  test("a negative displacement", () => {
    expect(replacement("lea -32(a0),a0\nlea -32(a0),a0\nmove.l d0,(a0)")).toBe(
      "\tlea -64(a0),a0",
    );
  });

  test("is always safe", () => {
    const d = lint("lea 32(a0),a0\nlea 32(a0),a0\nmove.l d0,(a0)").find(
      (x) => x.ruleId === ID,
    );
    expect(d?.suggestion?.applicability).toBe("safe");
  });
});

describe("does not fold", () => {
  test("adjustments that cancel out", () => {
    // More likely a mistake than something to delete without comment.
    expect(fires("lea 2(a0),a0\nlea -2(a0),a0\nmove.l d0,(a0)")).toBe(false);
    expect(fires("addq.l #4,a0\nsubq.l #4,a0\nmove.l d0,(a0)")).toBe(false);
  });

  test("two ADDQ.Ls that combine-consecutive-addq already folds", () => {
    expect(fires("addq.l #3,a0\naddq.l #5,a0\nmove.l d0,(a0)")).toBe(false);
  });

  test("different registers", () => {
    expect(fires("lea 4(a0),a0\nlea 4(a1),a1\nmove.l d0,(a0)")).toBe(false);
  });

  test("across a label", () => {
    expect(fires("lea 4(a0),a0\nloop:\nlea 4(a0),a0\nbra loop")).toBe(false);
  });

  test("with the register read between them", () => {
    expect(fires("lea 4(a0),a0\nmove.l (a0),d0\nlea 4(a0),a0\nrts")).toBe(
      false,
    );
  });

  test("data registers, where the flags differ", () => {
    expect(fires("add.l #4,d0\nadd.l #4,d0\nrts")).toBe(false);
  });

  test("a named displacement or immediate", () => {
    expect(fires("lea offset(a0),a0\nlea 4(a0),a0\nrts")).toBe(false);
    expect(fires("adda.w #SIZE,a0\naddq.l #4,a0\nrts")).toBe(false);
  });

  test("a word immediate outside the signed 16-bit range", () => {
    // ADDA.W sign-extends 40000 to a negative number, so the source does not
    // add what it looks like it adds.
    expect(fires("adda.w #40000,a0\naddq.l #4,a0\nrts")).toBe(false);
  });

  test("a total beyond LEA's displacement", () => {
    expect(fires("lea 30000(a0),a0\nlea 30000(a0),a0\nrts")).toBe(false);
  });

  test("a LEA that loads from another register", () => {
    expect(fires("lea 4(a1),a0\nlea 4(a0),a0\nrts")).toBe(false);
  });
});

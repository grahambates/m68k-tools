import { lint } from "./helpers.js";

/**
 * A value derived from what the author wrote keeps the author's expression,
 * whether it is a name or a sum they chose to spell out (`10-1` for a DBRA
 * count). Only values made entirely of bare numbers collapse to a total, as
 * there is no expression to respect.
 */
const replacementOf = (id: string, source: string) =>
  lint(source).find((d) => d.ruleId === id)?.suggestion?.replacement;

const RTS = "\n\tmoveq #0,d7\n\trts";

describe("combine-consecutive-addq", () => {
  const id = "optimization/combine-consecutive-addq";
  test("keeps a written sum", () => {
    expect(replacementOf(id, `\taddq.l #2+1,d0\n\taddq.l #4,d0${RTS}`)).toBe(
      "\taddq.l #2+1+4,d0",
    );
  });
  test("bare numbers still collapse", () => {
    expect(replacementOf(id, `\taddq.l #2,d0\n\taddq.l #4,d0${RTS}`)).toBe(
      "\taddq.l #6,d0",
    );
  });
  test("does not bracket a product", () => {
    expect(replacementOf(id, `\taddq.l #2*2,d0\n\taddq.l #3,d0${RTS}`)).toBe(
      "\taddq.l #2*2+3,d0",
    );
  });
});

describe("combine-consecutive-shift", () => {
  const id = "optimization/combine-consecutive-shift";
  test("keeps a written sum", () => {
    expect(replacementOf(id, `\tlsl.w #1+1,d0\n\tlsl.w #2,d0${RTS}`)).toBe(
      "\tlsl.w #1+1+2,d0",
    );
  });
  test("bare numbers still collapse", () => {
    expect(replacementOf(id, `\tlsl.w #2,d0\n\tlsl.w #2,d0${RTS}`)).toBe(
      "\tlsl.w #4,d0",
    );
  });
});

describe("combine-consecutive-bit-ops", () => {
  const id = "optimization/combine-consecutive-bit-ops";
  test("keeps a written bit number", () => {
    expect(
      replacementOf(id, `\tbset #8-1,d0\n\tbset #1,d0\n\tmoveq #0,d7\n\trts`),
    ).toBe("\tor.b #(1<<(8-1))|(1<<1),d0");
  });
  test("bare bit numbers still make a mask", () => {
    expect(replacementOf(id, `\tbset #7,d0\n\tbset #1,d0${RTS}`)).toBe(
      "\tor.b #$82,d0",
    );
  });
});

describe("move-immediate-double-byte", () => {
  const id = "optimization/move-immediate-double-byte";
  test("keeps a written sum", () => {
    expect(replacementOf(id, `\tmove.l #100+50,d0\n\tadd.l d1,d2${RTS}`)).toBe(
      "\tmoveq #(100+50)/2,d0\n\tadd.b d0,d0",
    );
  });
  test("a bare number is halved", () => {
    expect(replacementOf(id, `\tmove.l #150,d0\n\tadd.l d1,d2${RTS}`)).toBe(
      "\tmoveq #75,d0\n\tadd.b d0,d0",
    );
  });
});

describe("combine-address-adjustments", () => {
  const id = "optimization/combine-address-adjustments";
  const fold = (body: string) => replacementOf(id, `${body}\n\tmove.l d0,(a0)`);
  test("keeps a written displacement", () => {
    expect(fold("\tlea 4*2(a0),a0\n\tlea 8(a0),a0")).toBe("\tlea 4*2+8(a0),a0");
  });
  test("keeps a name that is now allowed", () => {
    expect(fold("N equ 40\n\tlea N(a0),a0\n\tlea 8(a0),a0")).toBe(
      "\tlea N+8(a0),a0",
    );
  });
  test("subtracting a written sum negates it", () => {
    expect(fold("\tlea 100(a0),a0\n\tsub.l #3+1,a0")).toBe(
      "\tlea 100-(3+1)(a0),a0",
    );
  });
  test("a small written total stays a quick add", () => {
    expect(fold("\tlea 1+1(a0),a0\n\tlea 2(a0),a0")).toBe("\taddq.l #1+1+2,a0");
  });
  test("bare numbers still collapse", () => {
    expect(fold("\tlea 4(a0),a0\n\tlea 8(a0),a0")).toBe("\tlea 12(a0),a0");
  });
});

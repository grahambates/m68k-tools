import parse from "../../src/parse";

describe("instructionSize", () => {
  // Cross-checked with vasm 1.9: -m68020 -no-opt -Fbin.
  test.each([
    ["move.l 4.w(a0,d0),d1", 6],
    ["move.l 4.l(a0,d0),d1", 8],
    ["move.l 4.l(a0),d1", 8],
    ["move.l ([0.w,a0,d0],4.l),d1", 10],
    ["movem.l d0-d3,16(a0)", 6],
    ["movem.w $12345678,d0-d3", 8],
    ["bra.l *+100", 6],
    ["link.l a6,#-100000", 6],
    ["mulu.l d0,d1", 4],
    ["divs.l (a0),d1", 4],
    ["move.l 300(a0,d0.l),d1", 6],
    ["move.l 70000(a0,d0.l),d1", 8],
    ["move.l ([16,a0,d0.l],32),d1", 8],
    ["move.l ([70000,a0,d0.l],70000),d1", 12],
  ])("sizes %s as %i bytes", (source, bytes) => {
    const [result] = parse(` ${source}`);
    expect(result.bytes).toBe(bytes);
  });

  test("immediate W", () => {
    const [result] = parse(" add.w #1,d0");
    expect(result.bytes).toEqual(4);
  });

  test("immediate L", () => {
    const [result] = parse(" add.l #1,d0");
    expect(result.bytes).toEqual(6);
  });

  test("immediate quick", () => {
    const [result] = parse(" addq #1,d0");
    expect(result.bytes).toEqual(2);
  });

  test("abs.w", () => {
    const [result] = parse(" add.l d0,$f00.w");
    expect(result.bytes).toEqual(4);
  });

  test("abs.l", () => {
    const [result] = parse(" add.l d0,$f00");
    expect(result.bytes).toEqual(6);
  });

  test("bit operation", () => {
    const [result] = parse(" bchg #1,d0");
    expect(result.bytes).toEqual(4);
  });

  test("bset long immediate", () => {
    const [result] = parse(" bset.l #1,d0");
    expect(result.bytes).toEqual(4);
  });

  test("Bcc short", () => {
    const [result] = parse(" bra.s #foo");
    expect(result.bytes).toEqual(2);
  });

  test("Bcc word", () => {
    const [result] = parse(" bra.w #foo");
    expect(result.bytes).toEqual(4);
  });

  test("movem", () => {
    const [result] = parse(" movem.w d0-d6,-(sp)");
    expect(result.bytes).toEqual(4);
  });

  test("nop", () => {
    const [result] = parse(" nop");
    expect(result.bytes).toEqual(2);
  });

  describe("68020 instructions", () => {
    test("extb.l", () => {
      const [result] = parse(" extb.l d0");
      expect(result.bytes).toEqual(2);
    });

    test("rtd (displacement word)", () => {
      const [result] = parse(" rtd #8");
      expect(result.bytes).toEqual(4);
    });

    test("pack (adjustment word)", () => {
      const [result] = parse(" pack d0,d1,#0");
      expect(result.bytes).toEqual(4);
    });

    test("bkpt (immediate embedded in opcode)", () => {
      const [result] = parse(" bkpt #3");
      expect(result.bytes).toEqual(2);
    });

    test("chk2 (mandatory extension word)", () => {
      const [result] = parse(" chk2.w d0,(a0)");
      expect(result.bytes).toEqual(4);
    });

    test("cas (mandatory extension word)", () => {
      const [result] = parse(" cas.w d0,d1,(a0)");
      expect(result.bytes).toEqual(4);
    });
  });
});

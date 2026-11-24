import { decodeCopperInstruction, isCopperEnd } from "../src/index";

// Examples from the Hardware Reference Manual's chapter 2.
describe("Copper instructions", () => {
  test("reads a MOVE", () => {
    expect(decodeCopperInstruction(0x00e0, 0x0002)).toEqual({
      kind: "move",
      register: 0x0e0,
      value: 0x0002,
    });
  });

  test("reads a WAIT for a line, ignoring the horizontal position", () => {
    // DC.W $9601,$FF00 ;Wait for line 150, ignore horizontal counters.
    expect(decodeCopperInstruction(0x9601, 0xff00)).toEqual({
      kind: "wait",
      vertical: 0x96,
      horizontal: 0,
      verticalMask: 0xff,
      horizontalMask: 0,
      waitsForBlitter: false,
    });
  });

  test("reads the horizontal position from bits 7-1", () => {
    expect(decodeCopperInstruction(0x2c07, 0xfffe)).toMatchObject({
      kind: "wait",
      vertical: 0x2c,
      horizontal: 0x06,
      horizontalMask: 0xfe,
    });
  });

  test("reads blitter-finished-disable clear as waiting for the blitter", () => {
    expect(decodeCopperInstruction(0x2c01, 0x7ffe)).toMatchObject({
      waitsForBlitter: true,
      // VP bit 7 is always compared.
      verticalMask: 0xff,
    });
  });

  test("tells a SKIP from a WAIT by bit 0 of the second word", () => {
    expect(decodeCopperInstruction(0x8001, 0xffff).kind).toBe("skip");
  });

  test("knows the usual end of a Copper list", () => {
    // DC.W $FFFF,$FFFE ;Wait for line 255, H = 254 (ends Copper list).
    expect(isCopperEnd(decodeCopperInstruction(0xffff, 0xfffe))).toBe(true);
    expect(isCopperEnd(decodeCopperInstruction(0xffdf, 0xfffe))).toBe(false);
    expect(isCopperEnd(decodeCopperInstruction(0xfe01, 0xfffe))).toBe(false);
  });
});

import operandMode from "../../src/parse/operandMode";
import { AddressingModes } from "../../src/syntax";

describe("operandMode", () => {
  test("direct data", () => {
    expect(operandMode("d0")).toEqual(AddressingModes.Dn);
    expect(operandMode("d7")).toEqual(AddressingModes.Dn);
  });

  test("direct address", () => {
    expect(operandMode("a0")).toEqual(AddressingModes.An);
    expect(operandMode("a7")).toEqual(AddressingModes.An);
    expect(operandMode("sp")).toEqual(AddressingModes.An);
  });

  test("indirect", () => {
    expect(operandMode("(a0)")).toEqual(AddressingModes.AnIndir);
    expect(operandMode("(a7)")).toEqual(AddressingModes.AnIndir);
    expect(operandMode("(sp)")).toEqual(AddressingModes.AnIndir);
  });

  test("indirect post increment", () => {
    expect(operandMode("(a0)+")).toEqual(AddressingModes.AnPostInc);
    expect(operandMode("(a7)+")).toEqual(AddressingModes.AnPostInc);
    expect(operandMode("(sp)+")).toEqual(AddressingModes.AnPostInc);
  });

  test("indirect pre decrement", () => {
    expect(operandMode("-(a0)")).toEqual(AddressingModes.AnPreDec);
    expect(operandMode("-(a7)")).toEqual(AddressingModes.AnPreDec);
    expect(operandMode("-(sp)")).toEqual(AddressingModes.AnPreDec);
  });

  test("indirect displacement", () => {
    expect(operandMode("1(a0)")).toEqual(AddressingModes.AnDisp);
    expect(operandMode("example(a0)")).toEqual(AddressingModes.AnDisp);
  });

  test("indirect displacement - old", () => {
    expect(operandMode("(1,a0)")).toEqual(AddressingModes.AnDisp);
    expect(operandMode("(-1,a0)")).toEqual(AddressingModes.AnDisp);
    expect(operandMode("(  1,a0  )")).toEqual(AddressingModes.AnDisp);
  });

  test("indirect displacement with index", () => {
    // Dn index
    expect(operandMode("1(a0,d0)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("1(a0,d0.w)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("1(a0,d0.l)")).toEqual(AddressingModes.AnDispIx);
    // An index
    expect(operandMode("1(a0,a0)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("1(a0,a0.w)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("1(a0,a0.l)")).toEqual(AddressingModes.AnDispIx);

    // sp
    expect(operandMode("1(sp,sp)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("1(sp,sp.w)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("1(sp,sp.l)")).toEqual(AddressingModes.AnDispIx);

    // old style
    expect(operandMode("(1,a0,d0)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(1,a0,d0.w)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(1,a0,a0)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(1,a0,a0.w)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(1,sp,sp)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(1,sp,sp.w)")).toEqual(AddressingModes.AnDispIx);

    // no displacement
    expect(operandMode("(a0,d0)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(a0,d0.w)")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(a0,a0.w)")).toEqual(AddressingModes.AnDispIx);
    // An unsized address-register index e.g. `(sp,sp)` is ambiguous and is
    // interpreted as a displacement expression rather than an index.
    expect(operandMode("(sp,sp)")).toEqual(AddressingModes.AnDisp);
    expect(operandMode("(sp,sp.w)")).toEqual(AddressingModes.AnDispIx);

    // whitespace
    expect(operandMode("1( a0,d0 )")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("(  1,a0,d0  )")).toEqual(AddressingModes.AnDispIx);
    expect(operandMode("( a2,a5.w)")).toEqual(AddressingModes.AnDispIx);
  });

  test("indirect displacement", () => {
    expect(operandMode("1(pc)")).toEqual(AddressingModes.PcDisp);
    expect(operandMode("(1,pc)")).toEqual(AddressingModes.PcDisp);
    expect(operandMode("(-1,pc)")).toEqual(AddressingModes.PcDisp);
    expect(operandMode("(  1,pc  )")).toEqual(AddressingModes.PcDisp);
  });

  test("indirect displacement with index PC", () => {
    expect(operandMode("1(pc,d0)")).toEqual(AddressingModes.PcDispIx);
    expect(operandMode("1(  pc,d0  )")).toEqual(AddressingModes.PcDispIx);
    expect(operandMode("(  1,pc,d0  )")).toEqual(AddressingModes.PcDispIx);
  });

  test("immediate", () => {
    expect(operandMode("#123")).toEqual(AddressingModes.Imm);
    expect(operandMode("#$12a")).toEqual(AddressingModes.Imm);
    expect(operandMode("#%01010")).toEqual(AddressingModes.Imm);
  });

  test("immediate symbol", () => {
    expect(operandMode("#foo")).toEqual(AddressingModes.Imm);
  });

  test("register list (movem)", () => {
    expect(operandMode("a0-a4")).toEqual(AddressingModes.RegList);
    expect(operandMode("a0/d0")).toEqual(AddressingModes.RegList);
    expect(operandMode("a0-a4/a6/d0-d3/d5/d7")).toEqual(
      AddressingModes.RegList,
    );
  });

  test("absolute word", () => {
    expect(operandMode("foo.w")).toEqual(AddressingModes.AbsW);
    expect(operandMode("$12a.w")).toEqual(AddressingModes.AbsW);
  });

  test("absolute long", () => {
    expect(operandMode("foo.l")).toEqual(AddressingModes.AbsL);
    expect(operandMode("$12a.l")).toEqual(AddressingModes.AbsL);
  });

  test("absolute long default", () => {
    expect(operandMode("foo")).toEqual(AddressingModes.AbsL);
    expect(operandMode("$12a")).toEqual(AddressingModes.AbsL);
  });

  test("case insensitive", () => {
    expect(operandMode("D0")).toEqual(AddressingModes.Dn);
  });
});

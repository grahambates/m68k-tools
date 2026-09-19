import { parseLine } from "../line-parser.js";
import { addressingMode } from "../addressing-mode.js";

const mode = (operand: string) => {
  // MOVEM is the carrier so a register list is read as one.
  const node = parseLine(`\tmovem ${operand}`).value.operands?.[0];
  return node && addressingMode(node);
};

describe("addressingMode", () => {
  it.each([
    ["d3", "dn"],
    ["a2", "an"],
    ["(a0)", "anIndirect"],
    ["(a0)+", "anPostInc"],
    ["-(a0)", "anPreDec"],
    ["4(a0)", "anOffset"],
    ["4(a0,d1.w)", "anIdx"],
    ["4(pc)", "pcOffset"],
    ["4(pc,d1.w)", "pcIdx"],
    ["label", "absL"],
    ["($1000).w", "absW"],
    ["($1000).l", "absL"],
    ["#5", "imm"],
    ["d0-d3/a0", "regList"],
    ["ccr", "ccr"],
    ["sr", "sr"],
    ["usp", "usp"],
  ] as const)("reads %s as %s", (operand, expected) => {
    expect(mode(operand)).toBe(expected);
  });

  it("has no mode for a special register without one", () => {
    expect(mode("vbr")).toBeUndefined();
  });

  it("has no mode for a string", () => {
    const node = parseLine('\tdc.b "hi"').value.operands?.[0];
    expect(node && addressingMode(node)).toBeUndefined();
  });
});

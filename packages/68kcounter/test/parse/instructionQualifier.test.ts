import { type InstructionStatement } from "../../src/parse/nodes";
import { AddressingModes, Mnemonics, Qualifiers } from "../../src/syntax";
import instructionQualifier from "../../src/parse/instructionQualifier";

describe("instructionQualifier()", () => {
  test("word default", () => {
    const result = instructionQualifier({
      opcode: { op: { name: Mnemonics.MOVE } },
    } as InstructionStatement);
    expect(result).toEqual(Qualifiers.W);
  });

  test("long default", () => {
    const result = instructionQualifier({
      opcode: { op: { name: Mnemonics.MOVEQ } },
    } as InstructionStatement);
    expect(result).toEqual(Qualifiers.L);
  });

  test("byte default", () => {
    const result = instructionQualifier({
      opcode: { op: { name: Mnemonics.SCC } },
    } as InstructionStatement);
    expect(result).toEqual(Qualifiers.B);
  });

  test("bit op - register", () => {
    const result = instructionQualifier({
      opcode: { op: { name: Mnemonics.BTST } },
      operands: [{}, { mode: AddressingModes.Dn }],
    } as InstructionStatement);
    expect(result).toEqual(Qualifiers.L);
  });

  test("bit op - memory", () => {
    const result = instructionQualifier({
      opcode: { op: { name: Mnemonics.BTST } },
      operands: [{}, { mode: AddressingModes.AbsW }],
    } as InstructionStatement);
    expect(result).toEqual(Qualifiers.B);
  });
});

import type { AddressingModeName } from "../addressing-mode.js";
import {
  addressRegisterForm,
  canonicalConditionMnemonic,
  encodedInstruction,
} from "../mnemonic-aliases.js";

describe("canonicalConditionMnemonic", () => {
  it.each([
    ["bhs", "bcc"],
    ["blo", "bcs"],
    ["dbhs", "dbcc"],
    ["dblo", "dbcs"],
    ["shs", "scc"],
    ["slo", "scs"],
    ["dbra", "dbf"],
    ["BLO", "bcs"],
  ])("reads %s as %s", (name, expected) => {
    expect(canonicalConditionMnemonic(name)).toBe(expected);
  });

  it("leaves everything else as it came, in lower case", () => {
    expect(canonicalConditionMnemonic("beq")).toBe("beq");
    expect(canonicalConditionMnemonic("MOVE")).toBe("move");
    expect(canonicalConditionMnemonic("bset")).toBe("bset");
    expect(canonicalConditionMnemonic("shifts")).toBe("shifts");
  });
});

describe("addressRegisterForm", () => {
  it("names the address form of a generic instruction", () => {
    expect(addressRegisterForm("move")).toBe("movea");
    expect(addressRegisterForm("ADD")).toBe("adda");
    expect(addressRegisterForm("sub")).toBe("suba");
    expect(addressRegisterForm("cmp")).toBe("cmpa");
  });

  it("has none for an instruction without one", () => {
    expect(addressRegisterForm("and")).toBeUndefined();
    expect(addressRegisterForm("movea")).toBeUndefined();
  });
});

// Each expectation was checked against the encoding vasm produces with
// -no-opt, so these are the instructions as written, not as optimised.
describe("encodedInstruction", () => {
  it.each<[string, (AddressingModeName | undefined)[], string]>([
    ["move", ["dn", "an"], "movea"],
    ["ADD", ["imm", "an"], "adda"],
    ["sub", ["anIndirect", "an"], "suba"],
    ["cmp", ["imm", "an"], "cmpa"],
    ["cmp", ["anPostInc", "anPostInc"], "cmpm"],
    ["add", ["imm", "anIndirect"], "addi"],
    ["sub", ["imm", "absL"], "subi"],
    ["cmp", ["imm", "anOffset"], "cmpi"],
    ["and", ["imm", "ccr"], "andi"],
    ["or", ["imm", "sr"], "ori"],
    ["eor", ["imm", "dn"], "eori"],
    ["eor", ["imm", undefined], "eori"],
  ])("encodes %s %j as %s", (name, modes, expected) => {
    expect(encodedInstruction(name, modes)).toBe(expected);
  });

  it("keeps the generic encoding for an immediate to a data register", () => {
    for (const name of ["add", "sub", "and", "or", "cmp"]) {
      expect(encodedInstruction(name, ["imm", "dn"])).toBe(name);
    }
  });

  it("chooses no immediate form for a destination it cannot see", () => {
    expect(encodedInstruction("add", ["imm", undefined])).toBe("add");
    expect(encodedInstruction("add", ["imm"])).toBe("add");
  });

  it("reads condition-code synonyms as their canonical spelling", () => {
    expect(encodedInstruction("DBRA", ["dn", "absL"])).toBe("dbf");
    expect(encodedInstruction("bhs", ["absL"])).toBe("bcc");
  });

  it("leaves other instructions as written, in lower case", () => {
    expect(encodedInstruction("MOVE", ["dn", "anIndirect"])).toBe("move");
    expect(encodedInstruction("addq", ["imm", "an"])).toBe("addq");
    expect(encodedInstruction("movea", ["dn", "an"])).toBe("movea");
    expect(encodedInstruction("move", ["usp", "an"])).toBe("move");
    expect(encodedInstruction("nop", [])).toBe("nop");
  });
});

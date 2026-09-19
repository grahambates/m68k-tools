import {
  addressRegisterForm,
  canonicalConditionMnemonic,
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

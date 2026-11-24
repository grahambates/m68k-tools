import {
  CIA_BASE,
  ciaBase,
  ciaDocs,
  ciaDocsFor,
  ciaManualUrl,
  ciaRegister,
  ciaRegisterAt,
  ciaRegisters,
  decodeRegisterValue,
  flagSymbol,
  type RegisterBit,
} from "../src/index";

// The Hardware Reference Manual's Appendix F address maps, and the offsets
// in the NDK's hardware/cia.i.
describe("CIA registers", () => {
  test.each([
    ["ciapra", "PRA", 0x000, 0xbfe001, 0xbfd000],
    ["ciaprb", "PRB", 0x100, 0xbfe101, 0xbfd100],
    ["ciatalo", "TALO", 0x400, 0xbfe401, 0xbfd400],
    ["ciatodhi", "TODHI", 0xa00, 0xbfea01, 0xbfda00],
    // Register $B is not connected, so SDR is $C.
    ["ciasdr", "SDR", 0xc00, 0xbfec01, 0xbfdc00],
    ["ciaicr", "ICR", 0xd00, 0xbfed01, 0xbfdd00],
    ["CIACRB", "CRB", 0xf00, 0xbfef01, 0xbfdf00],
  ])("%s is %s at $%s", (symbol, name, offset, a, b) => {
    const register = ciaRegister(symbol);
    expect(register).toMatchObject({ name, offset });
    expect(CIA_BASE.A + offset).toBe(a);
    expect(CIA_BASE.B + offset).toBe(b);
  });

  test("lists all fifteen connected registers once", () => {
    const offsets = ciaRegisters.map(({ offset }) => offset);
    expect(offsets).toHaveLength(15);
    expect(new Set(offsets).size).toBe(15);
    expect(offsets).not.toContain(0xb00);
  });

  test("links each register to its page of Appendix F", () => {
    expect(ciaManualUrl("ICR")).toMatch(/node0142\.html$/);
    expect(ciaManualUrl("ciapra".slice(3))).toMatch(/node014A\.html$/);
    expect(ciaManualUrl()).toMatch(/node012E\.html$/);
  });

  test("knows the base symbols, with or without the underscore", () => {
    expect(ciaBase("ciaa")).toBe("A");
    expect(ciaBase("_ciaa")).toBe("A");
    expect(ciaBase("_CIAB")).toBe("B");
    expect(ciaBase("ciac")).toBeUndefined();
  });

  test("describes each port register for its chip", () => {
    const bit6 = (doc: { bits?: readonly RegisterBit[] }) =>
      doc.bits?.find((bit) => bit.bits === 6)?.name;
    expect(ciaDocsFor("PRA", "A").map(bit6)).toEqual(["/FIR0"]);
    expect(ciaDocsFor("PRA", "B").map(bit6)).toEqual(["/RTS"]);
    // Without a chip, both.
    expect(ciaDocsFor("PRA")).toHaveLength(2);
    // A register the chips share has one description.
    expect(ciaDocsFor("ICR", "A")).toHaveLength(1);
  });

  test.each(ciaDocs.map((doc) => [doc.names.join("/"), doc] as const))(
    "%s keeps its bits within a byte",
    (_, doc) => {
      for (const bit of doc.bits ?? []) {
        const [high, low] =
          typeof bit.bits === "number" ? [bit.bits, bit.bits] : bit.bits;
        expect(high).toBeLessThanOrEqual(7);
        expect(low).toBeGreaterThanOrEqual(0);
      }
    },
  );
});

describe("CIA flags", () => {
  test.each([
    ["CIAB_GAMEPORT0", 6, "/FIR0", false],
    ["CIAF_LED", 1, "/LED", false],
    // CIAB_ is "CIA bit": these are on CIA-B's ports.
    ["CIAB_COMDTR", 7, "/DTR", true],
    ["CIAF_DSKMOTOR", 7, "/MTR", false],
    ["CIAICRB_TA", 0, "TA", true],
    ["ciaicrf_setclr", 7, "S/C", false],
    ["CIACRAB_START", 0, "START", true],
    ["CIACRBB_ALARM", 7, "ALARM", true],
  ])("%s is bit %i, %s", (symbol, bit, name, bitNumber) => {
    const flag = flagSymbol(symbol);
    expect(flag?.bits.map((b) => [b.bits, b.name])).toEqual([[bit, name]]);
    if (bitNumber) expect(flag?.bitNumber).toBe(true);
  });

  test("names the register a port flag belongs to", () => {
    expect(
      flagSymbol("CIAB_GAMEPORT0")?.docs.map((doc) => [doc.names[0], doc.cia]),
    ).toEqual([["PRA", "A"]]);
    expect(
      flagSymbol("CIAB_DSKSTEP")?.docs.map((doc) => [doc.names[0], doc.cia]),
    ).toEqual([["PRB", "B"]]);
  });

  test("decodes a byte written to the ICR with its SET/CLR in bit 7", () => {
    const [icr] = ciaDocsFor("ICR");
    const set = decodeRegisterValue(icr, 0x81)!;
    expect(set.setClear).toBe("set");
    expect(set.flags.map((bit) => bit.name)).toEqual(["TA"]);
    const clear = decodeRegisterValue(icr, 0x7f)!;
    expect(clear.setClear).toBe("clear");
    // Bits 6 and 5 are not connected.
    expect(clear.unknown).toEqual([6, 5]);
  });
});

describe("CIA register addresses", () => {
  test.each([
    [0xbfe001, "A", "PRA"],
    [0xbfed01, "A", "ICR"],
    [0xbfd100, "B", "PRB"],
    [0xbfdf00, "B", "CRB"],
  ])("$%s is CIA-%s %s", (address, cia, name) => {
    expect(ciaRegisterAt(address)).toMatchObject({ cia, register: { name } });
  });

  test("knows nothing at other addresses", () => {
    expect(ciaRegisterAt(0xbfe000)).toBeUndefined();
    expect(ciaRegisterAt(0xbfeb01)).toBeUndefined();
    expect(ciaRegisterAt(0xbfd001)).toBeUndefined();
  });
});

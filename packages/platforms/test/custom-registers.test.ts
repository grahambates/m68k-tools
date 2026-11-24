import {
  CUSTOM_BASE,
  customRegisterAt,
  customRegisters,
  customRegisterSymbols,
  hardwareManualUrl,
} from "../src/index";

// Spot checks against the Amiga Hardware Reference Manual's register summary
// in address order (Appendix B).
describe("Amiga custom registers", () => {
  test.each([
    [0xdff002, "DMACONR", "read-only"],
    [0xdff01c, "INTENAR", "read-only"],
    [0xdff096, "DMACON", "write-only"],
    [0xdff09a, "INTENA", "write-only"],
    [0xdff100, "BPLCON0", "write-only"],
    // The generated families, at both ends.
    [0xdff0a0, "AUD0LCH", "write-only"],
    [0xdff0da, "AUD3DAT", "write-only"],
    [0xdff0f6, "BPL6PTL", "write-only"],
    [0xdff17e, "SPR7DATB", "write-only"],
    [0xdff180, "COLOR00", "write-only"],
    [0xdff1be, "COLOR31", "write-only"],
  ])("%s is %s, %s", (address, name, access) => {
    expect(customRegisterAt(address)).toEqual({
      name,
      offset: address - CUSTOM_BASE,
      access,
    });
  });

  test.each([
    // ECS, from the manual's Appendix C register map.
    [0xdff07c, "DENISEID", "read-only", "ECS"],
    [0xdff106, "BPLCON3", "write-only", "ECS"],
    [0xdff1dc, "BEAMCON0", "write-only", "ECS"],
    [0xdff1e4, "DIWHIGH", "write-only", "ECS"],
    // AGA, from AGA.guide's register table.
    [0xdff0fc, "BPL8PTH", "write-only", "AGA"],
    [0xdff10c, "BPLCON4", "write-only", "AGA"],
    // AGA.guide's own entry says $10C, which is BPLCON4.
    [0xdff10e, "CLXCON2", "write-only", "AGA"],
    [0xdff11e, "BPL8DAT", "write-only", "AGA"],
    [0xdff1fc, "FMODE", "write-only", "AGA"],
  ])("%s is %s, %s, %s", (address, name, access, chipset) => {
    expect(customRegisterAt(address)).toEqual({
      name,
      offset: address - CUSTOM_BASE,
      access,
      chipset,
    });
  });

  test("leaves out addresses with no register", () => {
    // Reserved, between BPLHPTL and FMODE.
    expect(customRegisterAt(0xdff1f0)).toBeUndefined();
  });

  test("reads the one readable register in the display-sync block", () => {
    expect(customRegisterAt(0xdff1da)).toMatchObject({
      name: "HHPOSR",
      access: "read-only",
      chipset: "ECS",
    });
    expect(customRegisterAt(0xdff1d8)?.access).toBe("write-only");
  });

  test("lists each register once, in address order", () => {
    const offsets = customRegisters.map(({ offset }) => offset);
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  test("names registers as the includes do, pointer pairs as one long", () => {
    expect(customRegisterSymbols.get("intena")).toBe(0x09a);
    expect(customRegisterSymbols.get("cop1lch")).toBe(0x080);
    expect(customRegisterSymbols.get("cop1lc")).toBe(0x080);
    expect(customRegisterSymbols.get("bpl1pt")).toBe(0x0e0);
    expect(customRegisterSymbols.has("INTENA")).toBe(false);
  });

  test("links every register to its page in the Hardware Reference Manual", () => {
    // Every original register, and every ECS register the manual's
    // Appendix C lists. It leaves out the UHRES registers, and AGA has no
    // official manual.
    const ecsInManual = new Set([
      "BLTCON0L",
      "BLTSIZV",
      "BLTSIZH",
      "DENISEID",
      "BPLCON3",
      "BEAMCON0",
      "DIWHIGH",
      "HTOTAL",
      "HSSTOP",
      "HBSTRT",
      "HBSTOP",
      "VTOTAL",
      "VSSTOP",
      "VBSTRT",
      "VBSTOP",
      "HSSTRT",
      "VSSTRT",
      "HCENTER",
    ]);
    expect(
      customRegisters.filter(
        ({ name, chipset }) =>
          (!chipset || ecsInManual.has(name)) && !hardwareManualUrl(name),
      ),
    ).toEqual([]);
    expect(hardwareManualUrl("intena")).toBe(
      "http://amigadev.elowar.com/read/ADCD_2.1/Hardware_Manual_guide/node0036.html",
    );
    expect(hardwareManualUrl("cop1lc")).toBe(hardwareManualUrl("COP1LCH"));
    expect(hardwareManualUrl("FMODE")).toBeUndefined();
  });
});

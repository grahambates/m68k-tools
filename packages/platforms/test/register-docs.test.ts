import {
  customRegisters,
  decodeRegisterValue,
  flagSymbol,
  registerDoc,
  registerDocs,
  type RegisterBit,
} from "../src/index";

const span = ({ bits }: RegisterBit): number[] => {
  const [high, low] = typeof bits === "number" ? [bits, bits] : bits;
  return Array.from({ length: high - low + 1 }, (_, i) => low + i);
};

describe("Amiga register docs", () => {
  test("describes every register in the table", () => {
    expect(
      customRegisters
        .filter(({ name }) => !registerDoc(name))
        .map(({ name }) => name),
    ).toEqual([]);
  });

  test.each(registerDocs.map((doc) => [doc.names.join("/"), doc] as const))(
    "%s has bits within a word that do not overlap",
    (_, doc) => {
      const used = (doc.bits ?? []).flatMap(span);
      expect(used.every((bit) => bit >= 0 && bit <= 15)).toBe(true);
      expect(new Set(used).size).toBe(used.length);
    },
  );

  test("finds a register in any case, through its family or its pair", () => {
    expect(registerDoc("intena")?.names).toEqual(["INTENA", "INTENAR"]);
    expect(registerDoc("Aud2Vol")?.names).toEqual(["AUDxVOL"]);
    expect(registerDoc("COLOR17")?.names).toEqual(["COLORxx"]);
    expect(registerDoc("bltcpth")?.names).toEqual(["BLTxPTH", "BLTxPTL"]);
    // Listed apart from BLTxDAT.
    expect(registerDoc("BLTDDAT")?.names).toEqual(["BLTDDAT"]);
    expect(registerDoc("cop1lc")?.names).toEqual(["COP1LCH", "COP1LCL"]);
    expect(registerDoc("bpl3pt")?.names).toEqual(["BPLxPTH", "BPLxPTL"]);
    expect(registerDoc("COLOR32")).toBeUndefined();
    expect(registerDoc("bpl8pt")?.names).toEqual(["BPLxPTH", "BPLxPTL"]);
    expect(registerDoc("NOTAREG")).toBeUndefined();
  });
});

describe("flag symbols", () => {
  const names = (name: string) => flagSymbol(name)?.bits.map((bit) => bit.name);

  test.each([
    ["DMAF_SPRITE", ["SPREN"]],
    // Named differently in the includes and the manual.
    ["DMAF_RASTER", ["BPLEN"]],
    ["DMAF_BLITHOG", ["BLTPRI"]],
    ["dmaf_setclr", ["SET/CLR"]],
    ["DMAF_AUDIO", ["AUD3EN", "AUD2EN", "AUD1EN", "AUD0EN"]],
    ["INTF_VERTB", ["VERTB"]],
    ["INTF_DSKSYNC", ["DSKSYN"]],
    ["INTB_SOFTINT", ["SOFT"]],
    ["ADKF_FAST", ["FAST"]],
    ["ADKF_PRECOMP1", ["PRECOMP1"]],
  ])("%s names %j", (name, bits) => {
    expect(names(name)).toEqual(bits);
  });

  test("tells a bit number from a mask", () => {
    expect(flagSymbol("DMAB_SPRITE")?.bitNumber).toBe(true);
    expect(flagSymbol("DMAF_SPRITE")?.bitNumber).toBe(false);
    // A bit number cannot name several bits.
    expect(flagSymbol("DMAB_AUDIO")).toBeUndefined();
  });

  test("names every register the flags belong to", () => {
    expect(flagSymbol("INTF_VERTB")?.docs.map((doc) => doc.names[0])).toEqual([
      "INTENA",
      "INTREQ",
    ]);
  });

  test.each(["DMAF_NONSENSE", "FOO_BAR", "INTF", "dmacon"])(
    "knows nothing of %s",
    (name) => {
      expect(flagSymbol(name)).toBeUndefined();
    },
  );
});

describe("decoding a value written to a register", () => {
  const decode = (name: string, value: number) =>
    decodeRegisterValue(registerDoc(name)!, value);
  const flagNames = (name: string, value: number) =>
    decode(name, value)?.flags.map((bit) => bit.name);

  test("says whether a SET/CLR register's bits are set or cleared", () => {
    expect(decode("DMACON", 0x8020)).toMatchObject({ setClear: "set" });
    expect(flagNames("DMACON", 0x8020)).toEqual(["SPREN"]);
    expect(decode("INTENA", 0x7fff)).toMatchObject({ setClear: "clear" });
    expect(flagNames("INTENA", 0x7fff)).toHaveLength(15);
  });

  test("gives each field its value, and the bits set", () => {
    const bplcon0 = decode("BPLCON0", 0x4204)!;
    expect(bplcon0.setClear).toBeUndefined();
    expect(bplcon0.flags.map((bit) => bit.name)).toEqual(["COLOR", "LACE"]);
    expect(bplcon0.fields.map(({ bit, value }) => [bit.name, value])).toEqual([
      ["BPU2–BPU0", 4],
    ]);
  });

  test("reads a zero field as what it means", () => {
    expect(decode("BLTSIZE", 0x0000)!.fields.map(({ value }) => value)).toEqual(
      [1024, 64],
    );
    expect(
      decode("BLTSIZE", (200 << 6) | 20)!.fields.map(({ value }) => value),
    ).toEqual([200, 20]);
  });

  test("names bits written that nothing describes", () => {
    // DMACON bits 12 and 11 are unused.
    expect(decode("DMACON", 0x9800)!.unknown).toEqual([12, 11]);
    expect(decode("DMACON", 0x8020)!.unknown).toEqual([]);
  });

  test("has nothing to decode for a register without bits", () => {
    expect(decode("BPL1MOD", 40)).toBeUndefined();
  });
});

describe("ECS and AGA", () => {
  const bit = (register: string, name: string) =>
    registerDoc(register)?.bits?.find((b) => b.name === name);

  // BPLCON3 from AGA.guide; the manual's Appendix C gives only bits 5 and 4
  // on ECS.
  test.each([
    ["BANK2–BANK0", [15, 13], "AGA"],
    ["PF2OF2–PF2OF0", [12, 10], "AGA"],
    ["LOCT", 9, "AGA"],
    ["SPRES1–SPRES0", [7, 6], "AGA"],
    ["BRDRBLNK", 5, "ECS"],
    ["BRDNTRAN", 4, "ECS"],
    ["ZDCLKEN", 2, "AGA"],
    ["BRDSPRT", 1, "AGA"],
    ["EXTBLKEN", 0, "AGA"],
  ])("BPLCON3 %s is bits %j, %s", (name, bits, chipset) => {
    expect(bit("BPLCON3", name)).toMatchObject({ bits, chipset });
  });

  test.each([
    // The manual's Appendix C, "Other ECS Modifications".
    ["BLTCON1", "DOFF", 7, "ECS"],
    // The manual's Appendix C, "SuperHires 70ns Sprite Positioning", has
    // bit 3 named but unimplemented on ECS; AGA.guide adds bits 6 and 5.
    ["SPR0CTL", "SV9", 6, "AGA"],
    ["SPR0CTL", "EV9", 5, "AGA"],
    ["SPR0CTL", "SHSH1", 4, "ECS"],
    ["SPR0CTL", "SHSH0", 3, "AGA"],
    // The manual's Appendix C, "Determining Chip Revisions".
    ["VPOSR", "LOL", 7, "ECS"],
  ])("%s %s is bit %i, %s", (register, name, bits, chipset) => {
    expect(bit(register, name)).toMatchObject({ bits, chipset });
  });

  test("describes the programmable sync and UHRES registers as ECS", () => {
    for (const name of [
      "HTOTAL",
      "HSSTRT",
      "HBSTOP",
      "HCENTER",
      "VTOTAL",
      "VSSTOP",
      "VBSTRT",
      "HHPOSR",
      "BPLHSTOP",
      "BPLHMOD",
      "BPLHPTL",
      "SPRHSTRT",
      "SPRHPTH",
      "SPRHDAT",
    ])
      expect([name, registerDoc(name)?.chipset]).toEqual([name, "ECS"]);
  });

  test("puts BEAMCON0's PAL bit at bit 5, $0020", () => {
    expect(bit("BEAMCON0", "PAL")?.bits).toBe(5);
  });

  test("labels the bits ECS and AGA added to older registers", () => {
    expect(bit("BPLCON0", "SHRES")?.chipset).toBe("ECS");
    expect(bit("BPLCON0", "BPU3")?.chipset).toBe("AGA");
    expect(bit("BPLCON0", "HIRES")?.chipset).toBeUndefined();
    expect(bit("BPLCON2", "KILLEHB")?.chipset).toBe("ECS");
    expect(bit("COLOR00", "T")?.chipset).toBe("AGA");
  });

  test("labels the registers ECS and AGA added", () => {
    expect(registerDoc("BEAMCON0")?.chipset).toBe("ECS");
    expect(registerDoc("FMODE")?.chipset).toBe("AGA");
    expect(registerDoc("INTENA")?.chipset).toBeUndefined();
  });

  test("decodes AGA bits as described, not as unknown", () => {
    const decoded = decodeRegisterValue(registerDoc("BPLCON0")!, 0x0211)!;
    expect(decoded.unknown).toEqual([]);
    expect(decoded.flags.map((b) => b.name)).toEqual([
      "COLOR",
      "BPU3",
      "ECSENA",
    ]);
  });
});

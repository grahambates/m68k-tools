import {
  customRegisters,
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
    expect(registerDoc("FMODE")).toBeUndefined();
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

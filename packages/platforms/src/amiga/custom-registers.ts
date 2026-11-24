import { HARDWARE_MANUAL_BASE, hardwareManualPages } from "./manual-links.js";

/** Base address of the Amiga custom chip registers. */
export const CUSTOM_BASE = 0xdff000;

/**
 * Whether a register is read or written. The custom chips decode reads and
 * writes separately, so most registers are strictly one or the other.
 */
export type CustomRegisterAccess = "read-only" | "write-only";

/** The chip set that added a register or bit, where it is not the original. */
export type Chipset = "ECS" | "AGA";

export interface CustomRegister {
  /** The name the Hardware Reference Manual gives it, in upper case. */
  name: string;
  /** Offset from the custom chip base, `CUSTOM_BASE`. */
  offset: number;
  access: CustomRegisterAccess;
  chipset?: Chipset;
}

// Address-ordered register list from the Amiga Hardware Reference Manual
// appendix.
//
// Omission is safe here and commission is not - a register absent from the
// table simply produces no diagnostic, while a wrong direction produces a
// confident false error. Registers ECS and AGA added are listed apart, each
// with the direction both the manual's ECS appendix (where it covers them) and
// AGA.guide's register table give. The display-sync block at $1C0-$1FE mixes
// directions: HHPOSR at $1DA is the one there that is read.
const OCS_READ_ONLY: readonly [number, string][] = [
  [0x000, "BLTDDAT"],
  [0x002, "DMACONR"],
  [0x004, "VPOSR"],
  [0x006, "VHPOSR"],
  [0x008, "DSKDATR"],
  [0x00a, "JOY0DAT"],
  [0x00c, "JOY1DAT"],
  [0x00e, "CLXDAT"],
  [0x010, "ADKCONR"],
  [0x012, "POT0DAT"],
  [0x014, "POT1DAT"],
  [0x016, "POTGOR"],
  [0x018, "SERDATR"],
  [0x01a, "DSKBYTR"],
  [0x01c, "INTENAR"],
  [0x01e, "INTREQR"],
];

// Irregular write-only registers. The repetitive families below are generated
// rather than transcribed, because that is where a slip would hide.
const OCS_WRITE_ONLY: readonly [number, string][] = [
  [0x020, "DSKPTH"],
  [0x022, "DSKPTL"],
  [0x024, "DSKLEN"],
  [0x026, "DSKDAT"],
  [0x028, "REFPTR"],
  [0x02a, "VPOSW"],
  [0x02c, "VHPOSW"],
  [0x02e, "COPCON"],
  [0x030, "SERDAT"],
  [0x032, "SERPER"],
  [0x034, "POTGO"],
  [0x036, "JOYTEST"],
  [0x038, "STREQU"],
  [0x03a, "STRVBL"],
  [0x03c, "STRHOR"],
  [0x03e, "STRLONG"],
  [0x040, "BLTCON0"],
  [0x042, "BLTCON1"],
  [0x044, "BLTAFWM"],
  [0x046, "BLTALWM"],
  [0x048, "BLTCPTH"],
  [0x04a, "BLTCPTL"],
  [0x04c, "BLTBPTH"],
  [0x04e, "BLTBPTL"],
  [0x050, "BLTAPTH"],
  [0x052, "BLTAPTL"],
  [0x054, "BLTDPTH"],
  [0x056, "BLTDPTL"],
  [0x058, "BLTSIZE"],
  [0x060, "BLTCMOD"],
  [0x062, "BLTBMOD"],
  [0x064, "BLTAMOD"],
  [0x066, "BLTDMOD"],
  [0x070, "BLTCDAT"],
  [0x072, "BLTBDAT"],
  [0x074, "BLTADAT"],
  [0x07e, "DSKSYNC"],
  [0x080, "COP1LCH"],
  [0x082, "COP1LCL"],
  [0x084, "COP2LCH"],
  [0x086, "COP2LCL"],
  [0x088, "COPJMP1"],
  [0x08a, "COPJMP2"],
  [0x08c, "COPINS"],
  [0x08e, "DIWSTRT"],
  [0x090, "DIWSTOP"],
  [0x092, "DDFSTRT"],
  [0x094, "DDFSTOP"],
  [0x096, "DMACON"],
  [0x098, "CLXCON"],
  [0x09a, "INTENA"],
  [0x09c, "INTREQ"],
  [0x09e, "ADKCON"],
  [0x100, "BPLCON0"],
  [0x102, "BPLCON1"],
  [0x104, "BPLCON2"],
  [0x108, "BPL1MOD"],
  [0x10a, "BPL2MOD"],
];

function generatedWriteOnly(): [number, string][] {
  const entries: [number, string][] = [];
  // Audio: four channels of LCH/LCL/LEN/PER/VOL/DAT, 16 bytes apart.
  const audio = ["LCH", "LCL", "LEN", "PER", "VOL", "DAT"];
  for (let channel = 0; channel < 4; channel++) {
    audio.forEach((field, i) =>
      entries.push([0x0a0 + channel * 0x10 + i * 2, `AUD${channel}${field}`]),
    );
  }
  // Bitplane pointers BPL1PTH..BPL6PTL and data BPL1DAT..BPL6DAT.
  for (let plane = 1; plane <= 6; plane++) {
    entries.push([0x0e0 + (plane - 1) * 4, `BPL${plane}PTH`]);
    entries.push([0x0e2 + (plane - 1) * 4, `BPL${plane}PTL`]);
    entries.push([0x110 + (plane - 1) * 2, `BPL${plane}DAT`]);
  }
  // Sprite pointers, then POS/CTL/DATA/DATB per sprite.
  for (let sprite = 0; sprite < 8; sprite++) {
    entries.push([0x120 + sprite * 4, `SPR${sprite}PTH`]);
    entries.push([0x122 + sprite * 4, `SPR${sprite}PTL`]);
    ["POS", "CTL", "DATA", "DATB"].forEach((field, i) =>
      entries.push([0x140 + sprite * 8 + i * 2, `SPR${sprite}${field}`]),
    );
  }
  // COLOR00..COLOR31.
  for (let colour = 0; colour < 32; colour++) {
    entries.push([
      0x180 + colour * 2,
      `COLOR${String(colour).padStart(2, "0")}`,
    ]);
  }
  return entries;
}

// Registers ECS and AGA added. ECS from the Hardware Reference Manual's
// Appendix C register map and, for the UHRES registers it leaves out,
// AGA.guide's register table, which marks them new for the HiRes (ECS) chips;
// AGA from AGA.guide's register table.
const LATER: readonly [number, string, CustomRegisterAccess, Chipset][] = [
  [0x05a, "BLTCON0L", "write-only", "ECS"],
  [0x05c, "BLTSIZV", "write-only", "ECS"],
  [0x05e, "BLTSIZH", "write-only", "ECS"],
  [0x078, "SPRHDAT", "write-only", "ECS"],
  [0x07a, "BPLHDAT", "write-only", "ECS"],
  [0x07c, "DENISEID", "read-only", "ECS"],
  [0x0f8, "BPL7PTH", "write-only", "AGA"],
  [0x0fa, "BPL7PTL", "write-only", "AGA"],
  [0x0fc, "BPL8PTH", "write-only", "AGA"],
  [0x0fe, "BPL8PTL", "write-only", "AGA"],
  [0x106, "BPLCON3", "write-only", "ECS"],
  [0x10c, "BPLCON4", "write-only", "AGA"],
  // AGA.guide's entry for CLXCON2 says $10C, which is BPLCON4; its register
  // table has $10E.
  [0x10e, "CLXCON2", "write-only", "AGA"],
  [0x11c, "BPL7DAT", "write-only", "AGA"],
  [0x11e, "BPL8DAT", "write-only", "AGA"],
  [0x1c0, "HTOTAL", "write-only", "ECS"],
  [0x1c2, "HSSTOP", "write-only", "ECS"],
  [0x1c4, "HBSTRT", "write-only", "ECS"],
  [0x1c6, "HBSTOP", "write-only", "ECS"],
  [0x1c8, "VTOTAL", "write-only", "ECS"],
  [0x1ca, "VSSTOP", "write-only", "ECS"],
  [0x1cc, "VBSTRT", "write-only", "ECS"],
  [0x1ce, "VBSTOP", "write-only", "ECS"],
  [0x1d0, "SPRHSTRT", "write-only", "ECS"],
  [0x1d2, "SPRHSTOP", "write-only", "ECS"],
  [0x1d4, "BPLHSTRT", "write-only", "ECS"],
  [0x1d6, "BPLHSTOP", "write-only", "ECS"],
  [0x1d8, "HHPOSW", "write-only", "ECS"],
  [0x1da, "HHPOSR", "read-only", "ECS"],
  [0x1dc, "BEAMCON0", "write-only", "ECS"],
  [0x1de, "HSSTRT", "write-only", "ECS"],
  [0x1e0, "VSSTRT", "write-only", "ECS"],
  [0x1e2, "HCENTER", "write-only", "ECS"],
  [0x1e4, "DIWHIGH", "write-only", "ECS"],
  [0x1e6, "BPLHMOD", "write-only", "ECS"],
  [0x1e8, "SPRHPTH", "write-only", "ECS"],
  [0x1ea, "SPRHPTL", "write-only", "ECS"],
  [0x1ec, "BPLHPTH", "write-only", "ECS"],
  [0x1ee, "BPLHPTL", "write-only", "ECS"],
  [0x1fc, "FMODE", "write-only", "AGA"],
];

/** The custom chip registers whose direction is known, in address order. */
export const customRegisters: readonly CustomRegister[] = [
  ...OCS_READ_ONLY.map(([offset, name]) => ({
    name,
    offset,
    access: "read-only" as const,
  })),
  ...[...OCS_WRITE_ONLY, ...generatedWriteOnly()].map(([offset, name]) => ({
    name,
    offset,
    access: "write-only" as const,
  })),
  ...LATER.map(([offset, name, access, chipset]) => ({
    name,
    offset,
    access,
    chipset,
  })),
].sort((a, b) => a.offset - b.offset);

const byAddress = new Map(
  customRegisters.map((register) => [CUSTOM_BASE + register.offset, register]),
);

/** The register at an absolute address, such as `$DFF09A`. */
export function customRegisterAt(address: number): CustomRegister | undefined {
  return byAddress.get(address);
}

/**
 * The symbols the Amiga includes name these registers by, in lower case, with
 * their offsets from `CUSTOM_BASE`: `hardware/custom.i` defines `intena` as
 * $09A. A pointer pair is usually named as one long register as well, COP1LC
 * for COP1LCH/COP1LCL, and written with a single long MOVE.
 */
export const customRegisterSymbols: ReadonlyMap<string, number> = (() => {
  const symbols = new Map<string, number>();
  for (const { name, offset } of customRegisters) {
    symbols.set(name.toLowerCase(), offset);
    if (/(PT|LC)H$/.test(name))
      symbols.set(name.slice(0, -1).toLowerCase(), offset);
  }
  return symbols;
})();

/**
 * The Amiga Hardware Reference Manual's page on a register, for the full
 * details, or undefined for one the manual does not cover.
 */
export function hardwareManualUrl(name: string): string | undefined {
  const upper = name.toUpperCase();
  // A pointer pair named as one long register, COP1LC, is documented with its
  // halves, COP1LCH and COP1LCL.
  const page =
    hardwareManualPages.get(upper) ??
    (/(PT|LC)$/.test(upper) ? hardwareManualPages.get(upper + "H") : undefined);
  return page && HARDWARE_MANUAL_BASE + page;
}

/**
 * Short descriptions of the Amiga custom chip registers and their bits, for
 * hover.
 *
 * The wording is our own, kept to a sentence per register and a phrase per
 * bit; the Hardware Reference Manual page linked alongside has the full
 * details. Bit positions and names follow the manual's register summary
 * (Appendix A, as published on the Amiga Developer CD 2.1) for the original
 * chip set, its Appendix C for ECS, and AGA.guide for AGA, which has no
 * official documentation. Where they name a bit differently, the manual's
 * name is kept and the other mentioned. A register or bit not yet checked
 * against these is left out, as a wrong entry would mislead where a missing
 * one does not.
 */

import type { Chipset } from "./custom-registers.js";
import { ciaDocs, type Cia } from "./cia.js";

export interface RegisterBit {
  /** The bit, or the highest and lowest bits of a field. */
  bits: number | readonly [number, number];
  /** The manual's name for it, where it gives one. */
  name?: string;
  /**
   * The name the include files' flag symbols use for it, without the prefix,
   * where it differs from the manual's: DMACON's BPLEN is `DMAF_RASTER`.
   */
  include?: string;
  text: string;
  /** Interrupt level, for the interrupt bits. */
  level?: number;
  /** A bit that can only be read, in a register that is otherwise written. */
  readOnly?: boolean;
  /** What a field means when it is 0, where that is not 0: BLTSIZE's width is 64. */
  zero?: number;
  /** The chip set that added it, where it is not the original. */
  chipset?: Chipset;
  /** A blitter logic function, read as an equation by `describeMinterm`. */
  minterm?: true;
}

export interface RegisterDoc {
  /**
   * The registers it describes. Families are named as the manual names them,
   * with `x` for the channel or number: `AUDxVOL`, `COLORxx`.
   */
  names: readonly string[];
  summary: string;
  bits?: readonly RegisterBit[];
  /** Flag symbol prefixes the includes use for these bits: `DMAF_` and `DMAB_`. */
  flags?: string;
  /** The chip set that added the register, where it is not the original. */
  chipset?: Chipset;
  /** Its width in bits, where it is not a 16-bit custom chip register. */
  width?: 8;
  /** For a CIA register that differs between the two, which CIA. */
  cia?: Cia;
}

/** Whether a bit is SET/CLR, which says how the other bits written act. */
const isSetClear = (bit: RegisterBit) => bit.include === "SETCLR";

const setClear: RegisterBit = {
  bits: 15,
  name: "SET/CLR",
  include: "SETCLR",
  text: "1 sets the other bits written as 1, 0 clears them",
};

const interruptBits: readonly RegisterBit[] = [
  setClear,
  { bits: 14, name: "INTEN", text: "Master enable for all interrupts below" },
  { bits: 13, name: "EXTER", level: 6, text: "External interrupt" },
  {
    bits: 12,
    name: "DSKSYN",
    include: "DSKSYNC",
    level: 5,
    text: "Disk data matched DSKSYNC",
  },
  { bits: 11, name: "RBF", level: 5, text: "Serial receive buffer full" },
  { bits: 10, name: "AUD3", level: 4, text: "Audio channel 3 block finished" },
  { bits: 9, name: "AUD2", level: 4, text: "Audio channel 2 block finished" },
  { bits: 8, name: "AUD1", level: 4, text: "Audio channel 1 block finished" },
  { bits: 7, name: "AUD0", level: 4, text: "Audio channel 0 block finished" },
  { bits: 6, name: "BLIT", level: 3, text: "Blitter finished" },
  { bits: 5, name: "VERTB", level: 3, text: "Start of vertical blank" },
  { bits: 4, name: "COPER", level: 3, text: "Copper" },
  { bits: 3, name: "PORTS", level: 2, text: "I/O ports and CIA timers" },
  {
    bits: 2,
    name: "SOFT",
    include: "SOFTINT",
    level: 1,
    text: "Software interrupt",
  },
  { bits: 1, name: "DSKBLK", level: 1, text: "Disk block finished" },
  { bits: 0, name: "TBE", level: 1, text: "Serial transmit buffer empty" },
];

const counterPair = (what: string): readonly RegisterBit[] => [
  { bits: [15, 8], name: "Y7–Y0", text: `Vertical ${what}` },
  { bits: [7, 0], name: "X7–X0", text: `Horizontal ${what}` },
];

export const registerDocs: readonly RegisterDoc[] = [
  {
    names: ["ADKCON", "ADKCONR"],
    summary:
      "Audio modulation, disk and UART control. Bits written as 1 are set or cleared according to bit 15.",
    flags: "ADK",
    bits: [
      setClear,
      {
        bits: 14,
        name: "PRECOMP1",
        text: "Disk write precompensation, high bit: 280 ns, or 560 ns with PRECOMP0",
      },
      {
        bits: 13,
        name: "PRECOMP0",
        text: "Disk write precompensation, low bit: 140 ns, or 560 ns with PRECOMP1",
      },
      { bits: 12, name: "MFMPREC", text: "MFM precompensation (0: GCR)" },
      { bits: 11, name: "UARTBRK", text: "Send a UART break" },
      {
        bits: 10,
        name: "WORDSYNC",
        text: "Synchronise disk reads on the DSKSYNC word",
      },
      {
        bits: 9,
        name: "MSBSYNC",
        text: "Synchronise disk reads on the MSB (GCR)",
      },
      { bits: 8, name: "FAST", text: "Fast disk clock, 2 µs (MFM); 0 is 4 µs" },
      { bits: 7, name: "USE3PN", text: "Channel 3 modulates nothing" },
      {
        bits: 6,
        name: "USE2P3",
        text: "Channel 2 modulates channel 3's period",
      },
      {
        bits: 5,
        name: "USE1P2",
        text: "Channel 1 modulates channel 2's period",
      },
      {
        bits: 4,
        name: "USE0P1",
        text: "Channel 0 modulates channel 1's period",
      },
      { bits: 3, name: "USE3VN", text: "Channel 3 modulates nothing" },
      {
        bits: 2,
        name: "USE2V3",
        text: "Channel 2 modulates channel 3's volume",
      },
      {
        bits: 1,
        name: "USE1V2",
        text: "Channel 1 modulates channel 2's volume",
      },
      {
        bits: 0,
        name: "USE0V1",
        text: "Channel 0 modulates channel 1's volume",
      },
    ],
  },
  {
    names: ["AUDxDAT"],
    summary:
      "Audio channel data: two signed 8-bit samples, played high byte first. Loaded by DMA, or written directly.",
  },
  {
    names: ["AUDxLCH", "AUDxLCL"],
    summary:
      "Audio channel sample start address. Not a pointer: it only needs reloading to play from somewhere else.",
  },
  {
    names: ["AUDxLEN"],
    summary: "Audio channel sample length, in words.",
  },
  {
    names: ["AUDxPER"],
    summary:
      "Audio channel period: colour clocks per sample. 124 is the shortest DMA can manage.",
  },
  {
    names: ["AUDxVOL"],
    summary: "Audio channel volume, 0–64.",
    bits: [
      { bits: 6, text: "Full volume, 64" },
      { bits: [5, 0], text: "Volume 0–63" },
    ],
  },
  {
    names: ["BEAMCON0"],
    summary:
      "Beam counter control: PAL or NTSC, and programmable sync and blanking for other scan rates. Badly set, it can drive a monitor out of its range.",
    chipset: "ECS",
    bits: [
      {
        bits: 14,
        name: "HARDDIS",
        text: "Disable the hardwired display window limits",
      },
      {
        bits: 13,
        name: "LPENDIS",
        text: "Read the beam position, not the latched light pen position",
      },
      {
        bits: 12,
        name: "VARVBEN",
        text: "Vertical blank from VBSTRT and VBSTOP",
      },
      {
        bits: 11,
        name: "LOLDIS",
        text: "Disable the long and short line toggle",
      },
      {
        bits: 10,
        name: "CSCBEN",
        text: "Variable composite sync and blank on the HSY and VSY pins",
      },
      {
        bits: 9,
        name: "VARVSYEN",
        text: "Vertical sync from VSSTRT and VSSTOP",
      },
      {
        bits: 8,
        name: "VARHSYEN",
        text: "Horizontal sync from HSSTRT and HSSTOP",
      },
      {
        bits: 7,
        name: "VARBEAMEN",
        text: "Variable beam counters, from HTOTAL and VTOTAL",
      },
      { bits: 6, name: "DUAL", text: "Separate beam counter for UHRES" },
      { bits: 5, name: "PAL", text: "PAL timing; 0 is NTSC" },
      { bits: 4, name: "VARCSYEN", text: "Variable composite sync" },
      {
        bits: 3,
        name: "BLANKEN",
        text: "Composite blank redirection (unused on AGA)",
      },
      { bits: 2, name: "CSYTRUE", text: "Composite sync is active high" },
      { bits: 1, name: "VSYTRUE", text: "Vertical sync is active high" },
      { bits: 0, name: "HSYTRUE", text: "Horizontal sync is active high" },
    ],
  },
  {
    names: ["BLTAFWM", "BLTALWM"],
    summary:
      "Masks ANDed with the first and last word of each line from source A. All 1s for fill or line mode.",
  },
  {
    names: ["BLTCON0"],
    summary:
      "Blitter control: source A shift, which channels are used, and the logic function. Line mode (BLTCON1 bit 0) gives the shift bits another meaning.",
    bits: [
      {
        bits: [15, 12],
        name: "ASH3–ASH0",
        text: "Shift source A right 0–15 pixels (line mode: starting pixel)",
      },
      { bits: 11, name: "USEA", text: "Read source A" },
      { bits: 10, name: "USEB", text: "Read source B" },
      { bits: 9, name: "USEC", text: "Read source C" },
      { bits: 8, name: "USED", text: "Write destination D" },
      {
        bits: [7, 0],
        name: "LF7–LF0",
        text: "Minterms: which A/B/C combinations write 1 to D",
        minterm: true,
      },
    ],
  },
  {
    names: ["BLTCON1"],
    summary:
      "Blitter control: source B shift, fill, direction, and line mode. Several bits mean something else in line mode, shown after them.",
    bits: [
      {
        bits: [15, 12],
        name: "BSH3–BSH0",
        text: "Shift source B right 0–15 pixels (line mode: texture start)",
      },
      {
        bits: 7,
        name: "DOFF",
        text: "Disable the output to destination D",
        chipset: "ECS",
      },
      { bits: 6, text: "Line mode: SIGN, sign of the error term" },
      { bits: 4, name: "EFE", text: "Exclusive fill (line mode: SUD)" },
      { bits: 3, name: "IFE", text: "Inclusive fill (line mode: SUL)" },
      { bits: 2, name: "FCI", text: "Fill carry in (line mode: AUL)" },
      {
        bits: 1,
        name: "DESC",
        text: "Descending: addresses decrease (line mode: SING, one dot per line)",
      },
      { bits: 0, name: "LINE", text: "Line mode" },
    ],
  },
  {
    names: ["BLTCON0L"],
    summary: "The low byte of BLTCON0, the minterms, on its own.",
    chipset: "ECS",
    bits: [
      {
        bits: [7, 0],
        name: "LF7–LF0",
        text: "Minterms: which A/B/C combinations write 1 to D",
        minterm: true,
      },
    ],
  },
  {
    names: ["BLTDDAT"],
    summary:
      "Blitter destination data on its way to memory. Not readable by the CPU.",
  },
  {
    names: ["BLTSIZE"],
    summary:
      "Blitter size, and start: write it last. In line mode the width is 2 and the height the line length.",
    bits: [
      {
        bits: [15, 6],
        name: "H9–H0",
        text: "Height in lines (0 is 1024)",
        zero: 1024,
      },
      {
        bits: [5, 0],
        name: "W5–W0",
        text: "Width in words (0 is 64)",
        zero: 64,
      },
    ],
  },
  {
    names: ["BLTSIZV"],
    summary: "Blitter height, up to 15 bits. Write it before BLTSIZH.",
    chipset: "ECS",
  },
  {
    names: ["BLTSIZH"],
    summary: "Blitter width, up to 11 bits, and start: write it last.",
    chipset: "ECS",
  },
  {
    names: ["BLTxDAT"],
    summary:
      "Blitter source data, for A, B or C. Loaded by DMA, or preloaded by the CPU for an unused channel. Line mode: BLTADAT is $8000, BLTBDAT the texture.",
  },
  {
    names: ["BLTxMOD"],
    summary:
      "Blitter modulo for A, B, C or D: bytes added to the address at the end of each line. Line mode: BLTAMOD and BLTBMOD hold the slope terms.",
  },
  {
    names: ["BLTxPTH", "BLTxPTL"],
    summary:
      "Blitter address for source A, B, C or destination D. Left pointing past the data when the blit ends.",
  },
  {
    names: ["BPL1MOD", "BPL2MOD"],
    summary:
      "Bitplane modulo, odd planes (BPL1MOD) or even planes (BPL2MOD): bytes added to the address at the end of each line.",
  },
  {
    names: ["BPLCON0"],
    summary:
      "Display mode: resolution, number of bitplanes, HAM, dual playfield and interlace.",
    bits: [
      { bits: 15, name: "HIRES", text: "High resolution (70 ns pixels)" },
      {
        bits: [14, 12],
        name: "BPU2–BPU0",
        text: "Number of bitplanes, 0–6; 0–8 with BPU3 on AGA",
      },
      {
        bits: 11,
        name: "HOMOD",
        text: "Hold-and-modify; with 6 bitplanes and this clear, Extra Half-Brite",
      },
      {
        bits: 10,
        name: "DBLPF",
        text: "Dual playfield: odd planes form playfield 1, even planes playfield 2",
      },
      { bits: 9, name: "COLOR", text: "Colour on composite video" },
      { bits: 8, name: "GAUD", text: "Genlock audio" },
      {
        bits: 7,
        name: "UHRES",
        text: "Ultra high resolution: enables the UHRES pointers",
        chipset: "ECS",
      },
      {
        bits: 6,
        name: "SHRES",
        text: "Super high resolution (35 ns pixels); clear HIRES with it",
        chipset: "ECS",
      },
      {
        bits: 5,
        name: "BYPASS",
        text: "Bypass the colour table: bitplane data goes straight out (BPLHWRM on ECS)",
        chipset: "AGA",
      },
      {
        bits: 4,
        name: "BPU3",
        text: "High bit of the number of bitplanes (SPRHWRM on ECS)",
        chipset: "AGA",
      },
      { bits: 3, name: "LPEN", text: "Light pen" },
      { bits: 2, name: "LACE", text: "Interlace" },
      {
        bits: 1,
        name: "ERSY",
        text: "External resync: sync pins become inputs",
      },
      {
        bits: 0,
        name: "ECSENA",
        text: "Enable BPLCON3's border and ZD bits (ENBPLCN3 in the manual)",
        chipset: "ECS",
      },
    ],
  },
  {
    names: ["BPLCON1"],
    summary:
      "Horizontal scroll for each playfield, 0–15 low-resolution pixels. AGA adds finer and wider scrolling in the top byte, and renames the low byte's bits PF2H5–PF2H2 and PF1H5–PF1H2.",
    bits: [
      {
        bits: [15, 14],
        name: "PF2H7–PF2H6",
        text: "Playfield 2 delay, high bits, for wide fetch modes",
        chipset: "AGA",
      },
      {
        bits: [13, 12],
        name: "PF2H1–PF2H0",
        text: "Playfield 2 delay, fine bits, in 35 ns steps",
        chipset: "AGA",
      },
      {
        bits: [11, 10],
        name: "PF1H7–PF1H6",
        text: "Playfield 1 delay, high bits, for wide fetch modes",
        chipset: "AGA",
      },
      {
        bits: [9, 8],
        name: "PF1H1–PF1H0",
        text: "Playfield 1 delay, fine bits, in 35 ns steps",
        chipset: "AGA",
      },
      {
        bits: [7, 4],
        name: "PF2H3–PF2H0",
        text: "Playfield 2 (even planes) delay",
      },
      {
        bits: [3, 0],
        name: "PF1H3–PF1H0",
        text: "Playfield 1 (odd planes) delay",
      },
    ],
  },
  {
    names: ["BPLCON2"],
    summary:
      "Display priority: playfields against each other and against sprites. ECS and AGA add genlock and palette controls.",
    bits: [
      {
        bits: [14, 12],
        name: "ZDBPSEL2–ZDBPSEL0",
        text: "Bitplane that drives the ZD pin, with ZDBPEN",
        chipset: "ECS",
      },
      {
        bits: 11,
        name: "ZDBPEN",
        text: "ZD pin follows the bitplane ZDBPSEL selects",
        chipset: "ECS",
      },
      {
        bits: 10,
        name: "ZDCTEN",
        text: "ZD pin follows the colour table's transparency bit, not colour 0",
        chipset: "ECS",
      },
      {
        bits: 9,
        name: "KILLEHB",
        text: "Disable Extra Half-Brite",
        chipset: "ECS",
      },
      {
        bits: 8,
        name: "RDRAM",
        text: "Colour register addresses read the palette instead of writing it",
        chipset: "AGA",
      },
      {
        bits: 7,
        name: "SOGEN",
        text: "Drive the SOG output pin high",
        chipset: "AGA",
      },
      {
        bits: 6,
        name: "PF2PRI",
        text: "Playfield 2 (even planes) in front of playfield 1",
      },
      {
        bits: [5, 3],
        name: "PF2P2–PF2P0",
        text: "Playfield 2 position among the sprites",
      },
      {
        bits: [2, 0],
        name: "PF1P2–PF1P0",
        text: "Playfield 1 position among the sprites",
      },
    ],
  },
  {
    names: ["BPLCON3"],
    summary:
      "Enhanced display features: border, genlock, sprite resolution and AGA palette access. The border and ZD bits do nothing unless BPLCON0's ECSENA is set. Resets to $0C00: PF2OF is 3, an offset of 8.",
    chipset: "ECS",
    bits: [
      {
        bits: [15, 13],
        name: "BANK2–BANK0",
        text: "Which of the eight 32-colour banks COLORxx writes",
        chipset: "AGA",
      },
      {
        bits: [12, 10],
        name: "PF2OF2–PF2OF0",
        text: "Playfield 2's offset into the palette in dual playfield: 0, 2, 4, 8 … 128",
        chipset: "AGA",
      },
      {
        bits: 9,
        name: "LOCT",
        text: "COLORxx writes set the low nibbles of the 24-bit colour",
        chipset: "AGA",
      },
      {
        bits: [7, 6],
        name: "SPRES1–SPRES0",
        text: "Sprite resolution: default, low, high or super high",
        chipset: "AGA",
      },
      { bits: 5, name: "BRDRBLNK", text: "Border is blanked", chipset: "ECS" },
      {
        bits: 4,
        name: "BRDNTRAN",
        text: "Border is opaque to genlock",
        chipset: "ECS",
      },
      {
        bits: 2,
        name: "ZDCLKEN",
        text: "ZD pin outputs a 14 MHz clock instead",
        chipset: "AGA",
      },
      {
        bits: 1,
        name: "BRDSPRT",
        text: "Sprites show in the border",
        chipset: "AGA",
      },
      {
        bits: 0,
        name: "EXTBLKEN",
        text: "Blank output is programmable",
        chipset: "AGA",
      },
    ],
  },
  {
    names: ["BPLCON4"],
    summary:
      "Palette remapping: a mask for bitplane colours and the colour banks sprites use. Resets to $0011.",
    chipset: "AGA",
    bits: [
      {
        bits: [15, 8],
        name: "BPLAM7–BPLAM0",
        text: "XORed with each pixel's bitplane colour number",
      },
      {
        bits: [7, 4],
        name: "ESPRM7–ESPRM4",
        text: "Colour bank for even sprites: the high four bits of their colour numbers",
      },
      {
        bits: [3, 0],
        name: "OSPRM7–OSPRM4",
        text: "Colour bank for odd sprites: the high four bits of their colour numbers",
      },
    ],
  },
  {
    names: ["BPLxDAT"],
    summary:
      "Bitplane data, loaded by DMA. Writing BPL1DAT sends them all to the display, leftmost pixel first. Planes 7 and 8 are AGA.",
  },
  {
    names: ["BPLxPTH", "BPLxPTL"],
    summary:
      "Bitplane address. Reload it every frame, from the Copper or in vertical blank. Planes 7 and 8 are AGA.",
  },
  {
    names: ["CLXCON"],
    summary:
      "Collision control: which bitplanes take part and the value each must have, and which odd sprites count with their even partner.",
    bits: [
      { bits: 15, name: "ENSP7", text: "Sprite 7 counts with sprite 6" },
      { bits: 14, name: "ENSP5", text: "Sprite 5 counts with sprite 4" },
      { bits: 13, name: "ENSP3", text: "Sprite 3 counts with sprite 2" },
      { bits: 12, name: "ENSP1", text: "Sprite 1 counts with sprite 0" },
      { bits: [11, 6], name: "ENBP6–ENBP1", text: "Bitplane takes part" },
      {
        bits: [5, 0],
        name: "MVBP6–MVBP1",
        text: "Value the bitplane must have",
      },
    ],
  },
  {
    names: ["CLXCON2"],
    summary:
      "Collision control for bitplanes 7 and 8. Writing CLXCON clears it.",
    chipset: "AGA",
    bits: [
      { bits: 7, name: "ENBP8", text: "Bitplane 8 takes part" },
      { bits: 6, name: "ENBP7", text: "Bitplane 7 takes part" },
      { bits: 1, name: "MVBP8", text: "Value bitplane 8 must have" },
      { bits: 0, name: "MVBP7", text: "Value bitplane 7 must have" },
    ],
  },
  {
    names: ["CLXDAT"],
    summary:
      "Collisions since it was last read; reading clears it. Playfield 1 is the odd planes, 2 the even. Sprites count in pairs: 0 or 1, 2 or 3, and so on.",
    bits: [
      { bits: 14, text: "Sprite 4 with sprite 6" },
      { bits: 13, text: "Sprite 2 with sprite 6" },
      { bits: 12, text: "Sprite 2 with sprite 4" },
      { bits: 11, text: "Sprite 0 with sprite 6" },
      { bits: 10, text: "Sprite 0 with sprite 4" },
      { bits: 9, text: "Sprite 0 with sprite 2" },
      { bits: 8, text: "Playfield 2 with sprite 6" },
      { bits: 7, text: "Playfield 2 with sprite 4" },
      { bits: 6, text: "Playfield 2 with sprite 2" },
      { bits: 5, text: "Playfield 2 with sprite 0" },
      { bits: 4, text: "Playfield 1 with sprite 6" },
      { bits: 3, text: "Playfield 1 with sprite 4" },
      { bits: 2, text: "Playfield 1 with sprite 2" },
      { bits: 1, text: "Playfield 1 with sprite 0" },
      { bits: 0, text: "Playfield 1 with playfield 2" },
    ],
  },
  {
    names: ["COLORxx"],
    summary:
      "Colour palette entry, as 12-bit RGB: $RGB, four bits per component. On AGA these write one bank of the 256-entry 24-bit palette, selected by BPLCON3's BANK bits, and LOCT chooses the high or low nibbles.",
    bits: [
      {
        bits: 15,
        name: "T",
        text: "Transparent to genlock: this colour drives the ZD pin",
        chipset: "AGA",
      },
      { bits: [11, 8], name: "R3–R0", text: "Red" },
      { bits: [7, 4], name: "G3–G0", text: "Green" },
      { bits: [3, 0], name: "B3–B0", text: "Blue" },
    ],
  },
  {
    names: ["COP1LCH", "COP1LCL"],
    summary:
      "Copper list 1 address. The Copper restarts here every vertical blank, and when COPJMP1 is written.",
  },
  {
    names: ["COP2LCH", "COP2LCL"],
    summary:
      "Copper list 2 address. The Copper jumps here when COPJMP2 is written.",
  },
  {
    names: ["COPCON"],
    summary: "Copper control.",
    bits: [
      {
        bits: 1,
        name: "CDANG",
        text: "Danger: let the Copper write the blitter registers",
      },
    ],
  },
  {
    names: ["COPINS"],
    summary:
      "The address the Copper puts on the bus while fetching an instruction. Not for writing.",
  },
  {
    names: ["COPJMP1", "COPJMP2"],
    summary:
      "Strobe: any write restarts the Copper at COP1LC or COP2LC. The Copper can write it to jump.",
  },
  {
    names: ["DDFSTRT", "DDFSTOP"],
    summary:
      "Horizontal start and stop of bitplane data fetch, in colour clocks. Normal values are $38 and $D0.",
    bits: [{ bits: [7, 2], name: "H8–H3", text: "Horizontal position" }],
  },
  {
    names: ["DENISEID"],
    summary:
      "Denise revision, in the low byte: $FC for ECS Denise, $F8 for AGA Lisa. The original Denise has no such register, and reading it gives whatever was last on the bus.",
    chipset: "ECS",
  },
  {
    names: ["DIWHIGH"],
    summary:
      "High bits of the display window start and stop. Once written, DIWSTRT and DIWSTOP's implied bits no longer apply, so write it after them.",
    chipset: "ECS",
    bits: [
      {
        bits: 13,
        name: "H8",
        text: "Horizontal stop, high bit (H10 in AGA.guide)",
      },
      {
        bits: [12, 11],
        name: "H1–H0",
        text: "Horizontal stop, fine bits in 70 and 35 ns steps",
        chipset: "AGA",
      },
      { bits: [10, 8], name: "V10–V8", text: "Vertical stop, high bits" },
      {
        bits: 5,
        name: "H8",
        text: "Horizontal start, high bit (H10 in AGA.guide)",
      },
      {
        bits: [4, 3],
        name: "H1–H0",
        text: "Horizontal start, fine bits in 70 and 35 ns steps",
        chipset: "AGA",
      },
      { bits: [2, 0], name: "V10–V8", text: "Vertical start, high bits" },
    ],
  },
  {
    names: ["DIWSTRT", "DIWSTOP"],
    summary:
      "Display window: top left (DIWSTRT) and bottom right (DIWSTOP). The top bit of each position is implied: 0 for the start, and for the stop 1 horizontally and the opposite of V7 vertically.",
    bits: [
      { bits: [15, 8], name: "V7–V0", text: "Vertical position" },
      { bits: [7, 0], name: "H7–H0", text: "Horizontal position" },
    ],
  },
  {
    names: ["DMACON", "DMACONR"],
    summary:
      "DMA channel enables, and blitter status when read. Bits written as 1 are set or cleared according to bit 15.",
    flags: "DMA",
    bits: [
      setClear,
      {
        bits: 14,
        name: "BBUSY",
        include: "BLTDONE",
        readOnly: true,
        text: "Blitter busy",
      },
      {
        bits: 13,
        name: "BZERO",
        include: "BLTNZERO",
        readOnly: true,
        text: "Blitter result was all zero",
      },
      {
        bits: 10,
        name: "BLTPRI",
        include: "BLITHOG",
        text: 'Blitter takes priority over the CPU ("blitter nasty")',
      },
      {
        bits: 9,
        name: "DMAEN",
        include: "MASTER",
        text: "Master enable for all DMA below",
      },
      { bits: 8, name: "BPLEN", include: "RASTER", text: "Bitplane DMA" },
      { bits: 7, name: "COPEN", include: "COPPER", text: "Copper DMA" },
      { bits: 6, name: "BLTEN", include: "BLITTER", text: "Blitter DMA" },
      { bits: 5, name: "SPREN", include: "SPRITE", text: "Sprite DMA" },
      { bits: 4, name: "DSKEN", include: "DISK", text: "Disk DMA" },
      { bits: 3, name: "AUD3EN", include: "AUD3", text: "Audio channel 3 DMA" },
      { bits: 2, name: "AUD2EN", include: "AUD2", text: "Audio channel 2 DMA" },
      { bits: 1, name: "AUD1EN", include: "AUD1", text: "Audio channel 1 DMA" },
      { bits: 0, name: "AUD0EN", include: "AUD0", text: "Audio channel 0 DMA" },
    ],
  },
  {
    names: ["DSKBYTR"],
    summary: "Disk data, a byte at a time, with status.",
    bits: [
      { bits: 15, name: "DSKBYT", text: "A byte is ready; reading clears it" },
      { bits: 14, name: "DMAON", text: "Disk DMA is on (DSKLEN and DMACON)" },
      { bits: 13, name: "DISKWRITE", text: "DSKLEN's write bit" },
      { bits: 12, name: "WORDEQUAL", text: "The disk data matches DSKSYNC" },
      { bits: [7, 0], name: "DATA", text: "The byte" },
    ],
  },
  {
    names: ["DSKDAT", "DSKDATR"],
    summary: "Disk DMA data, two bytes. Transferred by DMA.",
  },
  {
    names: ["DSKLEN"],
    summary:
      "Disk DMA length and control. Writing it twice with DMAEN set starts the transfer.",
    bits: [
      { bits: 15, name: "DMAEN", text: "Disk DMA enable" },
      { bits: 14, name: "WRITE", text: "Write to disk; 0 reads" },
      { bits: [13, 0], name: "LENGTH", text: "Length in words" },
    ],
  },
  {
    names: ["DSKPTH", "DSKPTL"],
    summary: "Disk DMA address. Set it before enabling disk DMA.",
  },
  {
    names: ["DSKSYNC"],
    summary: "Disk sync word, matched when ADKCON's WORDSYNC is set.",
  },
  {
    names: ["FMODE"],
    summary:
      "Chip RAM fetch width for bitplanes and sprites: 16, 32 or 64 bits at a time, and scan-doubling.",
    chipset: "AGA",
    bits: [
      { bits: 15, name: "SSCAN2", text: "Sprite scan-doubling" },
      {
        bits: 14,
        name: "BSCAN2",
        text: "Bitplane scan-doubling: alternate lines use BPL2MOD",
      },
      {
        bits: 3,
        name: "SPAGEM",
        text: "Sprite page mode: double the sprite fetch",
      },
      { bits: 2, name: "SPR32", text: "32-bit sprite fetch" },
      {
        bits: 1,
        name: "BPAGEM",
        text: "Bitplane page mode: double the bitplane fetch",
      },
      {
        bits: 0,
        name: "BPL32",
        text: "32-bit bitplane fetch (BLP32 in AGA.guide)",
      },
    ],
  },
  {
    names: ["HTOTAL"],
    summary:
      "Colour clocks per line, less one, when BEAMCON0's VARBEAMEN or DUAL is set.",
    chipset: "ECS",
    bits: [
      { bits: [7, 0], name: "H8–H1", text: "Last colour clock of the line" },
    ],
  },
  {
    names: ["HSSTRT", "HSSTOP"],
    summary:
      "Horizontal sync start (HSSTRT) and stop (HSSTOP), in colour clocks, when BEAMCON0's VARHSYEN is set.",
    chipset: "ECS",
    bits: [{ bits: [7, 0], name: "H8–H1", text: "Horizontal position" }],
  },
  {
    names: ["HBSTRT", "HBSTOP"],
    summary:
      "Horizontal blank start (HBSTRT) and stop (HBSTOP), when BEAMCON0's programmable blanking is in use.",
    chipset: "ECS",
    bits: [
      { bits: [10, 8], text: "Fine position, in 35 ns steps", chipset: "AGA" },
      { bits: [7, 0], text: "Position, in 280 ns steps" },
    ],
  },
  {
    names: ["HCENTER"],
    summary:
      "Horizontal position of vertical sync on long fields, for interlace with variable beam counters.",
    chipset: "ECS",
    bits: [{ bits: [7, 0], name: "H8–H1", text: "Horizontal position" }],
  },
  {
    names: ["HHPOSR", "HHPOSW"],
    summary:
      "The second horizontal beam counter, which runs the UHRES pointers and horizontal comparisons in BEAMCON0's DUAL mode.",
    chipset: "ECS",
    bits: [{ bits: [7, 0], name: "H8–H1", text: "Horizontal position" }],
  },
  {
    names: ["BPLHSTRT"],
    summary: "The line UHRES bitplane fetch starts on.",
    chipset: "ECS",
    bits: [{ bits: [10, 0], name: "V10–V0", text: "Line" }],
  },
  {
    names: ["BPLHSTOP"],
    summary: "The line UHRES bitplane fetch stops on.",
    chipset: "ECS",
    bits: [
      {
        bits: 15,
        name: "BPLHWRM",
        text: "Invert ARW* while BPLHDAT is on the bus, for external memory",
      },
      { bits: [10, 0], name: "V10–V0", text: "Line" },
    ],
  },
  {
    names: ["BPLHMOD"],
    summary:
      "UHRES bitplane modulo: bytes added to the address at the end of each line.",
    chipset: "ECS",
  },
  {
    names: ["BPLHPTH", "BPLHPTL"],
    summary:
      "UHRES (VRAM) bitplane address, fetched in the second free cycle of each line when BPLCON0's UHRES is set.",
    chipset: "ECS",
  },
  {
    names: ["SPRHSTRT"],
    summary: "The line UHRES sprite display starts on.",
    chipset: "ECS",
    bits: [{ bits: [10, 0], name: "V10–V0", text: "Line" }],
  },
  {
    names: ["SPRHSTOP"],
    summary: "The line UHRES sprite display stops on.",
    chipset: "ECS",
    bits: [
      {
        bits: 15,
        name: "SPRHWRM",
        text: "Invert ARW* while SPRHDAT is on the bus, for external memory",
      },
      { bits: [10, 0], name: "V10–V0", text: "Line" },
    ],
  },
  {
    names: ["SPRHPTH", "SPRHPTL"],
    summary:
      "UHRES sprite address, fetched in the first and third free cycles of each line.",
    chipset: "ECS",
  },
  {
    names: ["SPRHDAT", "BPLHDAT"],
    summary:
      "Addresses the chips put on the bus to mark UHRES sprite and bitplane fetches for external logic. Not for writing.",
    chipset: "ECS",
  },
  {
    names: ["INTENA", "INTENAR"],
    summary:
      "Interrupt enable bits. Bits written as 1 are set or cleared according to bit 15.",
    flags: "INT",
    bits: interruptBits,
  },
  {
    names: ["INTREQ", "INTREQR"],
    summary:
      "Interrupt request bits, as INTENA. Not cleared automatically: clear a request by writing it with bit 15 clear.",
    flags: "INT",
    bits: interruptBits,
  },
  {
    names: ["JOY0DAT", "JOY1DAT"],
    summary:
      "Mouse counters for port 0 or 1. As a joystick: right is X1, left is Y1, down is X1 xor X0, up is Y1 xor Y0.",
    bits: counterPair("counter"),
  },
  {
    names: ["JOYTEST"],
    summary:
      "Writes all four mouse counters at once, except their low two bits.",
    bits: [
      { bits: [15, 10], name: "Y7–Y2", text: "Vertical counters" },
      { bits: [7, 2], name: "X7–X2", text: "Horizontal counters" },
    ],
  },
  {
    names: ["POT0DAT", "POT1DAT"],
    summary: "Potentiometer counters for port 0 or 1.",
    bits: counterPair("pot counter"),
  },
  {
    names: ["POTGO", "POTGOR"],
    summary:
      "The four pot pins as a bidirectional port, and the start of pot counting.",
    bits: [
      { bits: 15, name: "OUTRY", text: "Port 1 Y pin is an output" },
      { bits: 14, name: "DATRY", text: "Port 1 Y pin data" },
      { bits: 13, name: "OUTRX", text: "Port 1 X pin is an output" },
      { bits: 12, name: "DATRX", text: "Port 1 X pin data" },
      { bits: 11, name: "OUTLY", text: "Port 0 Y pin is an output" },
      { bits: 10, name: "DATLY", text: "Port 0 Y pin data" },
      { bits: 9, name: "OUTLX", text: "Port 0 X pin is an output" },
      { bits: 8, name: "DATLX", text: "Port 0 X pin data" },
      { bits: 0, name: "START", text: "Start the pot counters" },
    ],
  },
  {
    names: ["REFPTR"],
    summary: "Memory refresh address. For testing only: never write it.",
  },
  {
    names: ["SERDAT"],
    summary:
      "Serial transmit buffer: the data bits, with a stop bit above them whose position sets the word length.",
  },
  {
    names: ["SERDATR"],
    summary: "Serial receive buffer and status.",
    bits: [
      { bits: 15, name: "OVRUN", text: "Receive overrun" },
      { bits: 14, name: "RBF", text: "Receive buffer full" },
      { bits: 13, name: "TBE", text: "Transmit buffer empty" },
      { bits: 12, name: "TSRE", text: "Transmit shift register empty" },
      { bits: 11, name: "RXD", text: "The RXD pin, read directly" },
      { bits: 9, name: "STP", text: "Stop bit" },
      {
        bits: 8,
        name: "STP/DB8",
        text: "Stop bit, or data bit 8 for 9-bit words",
      },
      { bits: [7, 0], name: "DB7–DB0", text: "Data" },
    ],
  },
  {
    names: ["SERPER"],
    summary: "Serial port speed and word length.",
    bits: [
      { bits: 15, name: "LONG", text: "Receive 9-bit words" },
      {
        bits: [14, 0],
        name: "RATE",
        text: "Bit time: (N + 1) × 0.2794 µs",
      },
    ],
  },
  {
    names: ["SPRxCTL"],
    summary:
      "Sprite end line and control. Normally loaded by DMA; writing it disarms the sprite. AGA.guide renames SH0 to SH2, counting the finer horizontal bits as SH1 and SH0.",
    bits: [
      { bits: [15, 8], name: "EV7–EV0", text: "End line, low bits" },
      {
        bits: 7,
        name: "ATT",
        text: "Attach to the even sprite before it (odd sprites)",
      },
      { bits: 6, name: "SV9", text: "Start line, bit 9", chipset: "AGA" },
      { bits: 5, name: "EV9", text: "End line, bit 9", chipset: "AGA" },
      {
        bits: 4,
        name: "SHSH1",
        text: "Horizontal start, 70 ns step (SH1 in AGA.guide)",
        chipset: "ECS",
      },
      {
        bits: 3,
        name: "SHSH0",
        text: "Horizontal start, 35 ns step; named on ECS, working on AGA (SH0 in AGA.guide)",
        chipset: "AGA",
      },
      { bits: 2, name: "SV8", text: "Start line, high bit" },
      { bits: 1, name: "EV8", text: "End line, high bit" },
      { bits: 0, name: "SH0", text: "Horizontal start, low bit" },
    ],
  },
  {
    names: ["SPRxDATA", "SPRxDATB"],
    summary:
      "Sprite image data for the current line. Writing SPRxDATA arms the sprite.",
  },
  {
    names: ["SPRxPOS"],
    summary:
      "Sprite start position. Normally loaded by DMA. AGA.guide names the horizontal bits SH10–SH3, counting the finer bits in SPRxCTL.",
    bits: [
      { bits: [15, 8], name: "SV7–SV0", text: "Start line, low bits" },
      { bits: [7, 0], name: "SH8–SH1", text: "Horizontal start, high bits" },
    ],
  },
  {
    names: ["SPRxPTH", "SPRxPTL"],
    summary:
      "Sprite data address. Reload it every frame, from the Copper or in vertical blank.",
  },
  {
    names: ["STREQU", "STRVBL", "STRHOR", "STRLONG"],
    summary:
      "Strobe addresses used by the chips during refresh. Not for writing.",
  },
  {
    names: ["VTOTAL"],
    summary:
      "Lines per field, less one, when BEAMCON0's VARBEAMEN is set. With interlace, long fields have one more.",
    chipset: "ECS",
    bits: [{ bits: [10, 0], name: "V10–V0", text: "Last line of the field" }],
  },
  {
    names: ["VSSTRT", "VSSTOP"],
    summary:
      "Vertical sync start (VSSTRT) and stop (VSSTOP) lines, when BEAMCON0's VARVSYEN is set.",
    chipset: "ECS",
    bits: [{ bits: [10, 0], name: "V10–V0", text: "Line" }],
  },
  {
    names: ["VBSTRT", "VBSTOP"],
    summary:
      "Vertical blank start (VBSTRT) and stop (VBSTOP) lines, when BEAMCON0's VARVBEN is set.",
    chipset: "ECS",
    bits: [{ bits: [10, 0], name: "V10–V0", text: "Line" }],
  },
  {
    names: ["VHPOSR", "VHPOSW"],
    summary: "Beam position, or light pen position when it has latched.",
    bits: [
      { bits: [15, 8], name: "V7–V0", text: "Line, low bits" },
      {
        bits: [7, 0],
        name: "H8–H1",
        text: "Horizontal position, in colour clocks",
      },
    ],
  },
  {
    names: ["VPOSR", "VPOSW"],
    summary:
      "Beam line high bits, the long frame flag for interlace and, when read, the Agnus or Alice chip ID.",
    bits: [
      { bits: 15, name: "LOF", text: "Long frame" },
      {
        bits: [14, 8],
        name: "I6–I0",
        readOnly: true,
        text: "Agnus ID: $00 PAL or $10 NTSC original; $20 or $30 ECS; from $22 or $32 AGA Alice",
      },
      {
        bits: 7,
        name: "LOL",
        readOnly: true,
        text: "Long line; clear on a short line",
        chipset: "ECS",
      },
      { bits: [2, 1], name: "V10–V9", text: "Line, top bits", chipset: "ECS" },
      { bits: 0, name: "V8", text: "Line, high bit" },
    ],
  },
];

const byName = new Map<string, RegisterDoc>();
for (const doc of registerDocs)
  for (const name of doc.names) byName.set(name, doc);

/**
 * The description of a register by name, in any case: a numbered register is
 * found through its family (`AUD2VOL` through `AUDxVOL`), and a pointer pair
 * named as one long register (`COP1LC`) through its halves.
 */
export function registerDoc(name: string): RegisterDoc | undefined {
  const upper = name.toUpperCase();
  const pair = /(PT|LC)$/.test(upper) ? upper + "H" : undefined;
  for (const candidate of pair ? [upper, pair] : [upper]) {
    const doc = byName.get(candidate) ?? byName.get(familyName(candidate));
    if (doc) return doc;
  }
  return undefined;
}

/** A numbered register's family name, as the manual writes it. */
function familyName(name: string): string {
  return name
    .replace(/^AUD[0-3](LCH|LCL|LEN|PER|VOL|DAT)$/, "AUDx$1")
    .replace(/^BLT[A-D](DAT|MOD|PTH|PTL)$/, "BLTx$1")
    .replace(/^BPL[1-8](DAT|PTH|PTL)$/, "BPLx$1")
    .replace(/^SPR[0-7](PTH|PTL|POS|CTL|DATA|DATB)$/, "SPRx$1")
    .replace(/^COLOR(0\d|[12]\d|3[01])$/, "COLORxx");
}

/** A flag symbol from the includes, and the bits it names. */
export interface FlagSymbol {
  /** The registers using these flags: INTF_ names bits of INTENA and INTREQ. */
  docs: readonly RegisterDoc[];
  bits: readonly RegisterBit[];
  /** True for a bit number (`DMAB_`), false for a mask (`DMAF_`). */
  bitNumber: boolean;
}

// Flags the includes define for more than one bit.
const flagGroups: Readonly<Record<string, Record<string, readonly number[]>>> =
  {
    DMA: { AUDIO: [3, 2, 1, 0], ALL: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
  };

/**
 * The bits a flag symbol from the includes names, in any case: `DMAF_SPRITE`
 * is DMACON bit 5 as a mask, `INTB_VERTB` INTENA bit 5 as a bit number.
 */
export function flagSymbol(name: string): FlagSymbol | undefined {
  const match = /^([A-Z]+)([FB])_(\w+)$/.exec(name.toUpperCase());
  if (!match) return undefined;
  const [, prefix, kind, flag] = match;
  // Several registers can share a prefix: CIAB_ names bits in three CIA
  // ports, and INTF_ the same bits in INTENA and INTREQ.
  const group = flagGroups[prefix]?.[flag];
  const named = (doc: RegisterDoc) =>
    (doc.bits ?? []).filter((bit) =>
      typeof bit.bits !== "number"
        ? false
        : group
          ? group.includes(bit.bits)
          : (bit.include ?? bit.name)?.toUpperCase() === flag,
    );
  const docs = [...registerDocs, ...ciaDocs].filter(
    (doc) => doc.flags === prefix && named(doc).length,
  );
  const bits = docs.length ? named(docs[0]) : [];
  // A bit number names one bit; only a mask can name several.
  if (!bits.length || (kind === "B" && bits.length > 1)) return undefined;
  return { docs, bits, bitNumber: kind === "B" };
}

/** A value written to a register, read against its bits. */
export interface DecodedValue {
  /**
   * For a register written with a SET/CLR bit (bit 15, or bit 7 of a CIA's
   * ICR), whether the other bits written as 1 are set or cleared.
   */
  setClear?: "set" | "clear";
  /** The single bits written as 1, apart from SET/CLR. */
  flags: RegisterBit[];
  /** Each field, with the value it is given. */
  fields: { bit: RegisterBit; value: number }[];
  /** Bits written as 1 that nothing here describes, highest first. */
  unknown: number[];
}

/** A 16-bit value written to a register, read against its bits. */
export function decodeRegisterValue(
  doc: RegisterDoc,
  value: number,
): DecodedValue | undefined {
  if (!doc.bits?.length) return undefined;
  const width = doc.width ?? 16;
  const word = value & ((1 << width) - 1);
  const decoded: DecodedValue = { flags: [], fields: [], unknown: [] };
  let described = 0;
  for (const bit of doc.bits) {
    if (typeof bit.bits === "number") {
      described |= 1 << bit.bits;
      if (!(word & (1 << bit.bits))) continue;
      if (isSetClear(bit)) continue;
      decoded.flags.push(bit);
      continue;
    }
    const [high, low] = bit.bits;
    const fieldWidth = high - low + 1;
    const mask = ((1 << fieldWidth) - 1) << low;
    described |= mask;
    const field = (word & mask) >>> low;
    decoded.fields.push({
      bit,
      value: field === 0 && bit.zero ? bit.zero : field,
    });
  }
  const setClearBit = doc.bits.find(isSetClear);
  if (setClearBit)
    decoded.setClear =
      word & (1 << (setClearBit.bits as number)) ? "set" : "clear";
  for (let bit = width - 1; bit >= 0; bit--)
    if (word & (1 << bit) && !(described & (1 << bit)))
      decoded.unknown.push(bit);
  return decoded;
}

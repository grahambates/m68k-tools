/**
 * Short descriptions of the Amiga custom chip registers and their bits, for
 * hover.
 *
 * The wording is our own, kept to a sentence per register and a phrase per
 * bit; the Hardware Reference Manual page linked alongside has the full
 * details. Bit positions and names follow the manual's register summary
 * (Appendix A, as published on the Amiga Developer CD 2.1), which describes
 * the original chip set: bits ECS and AGA added are left out until checked
 * against a reference for them, as a wrong entry would mislead where a missing
 * one does not.
 */

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
}

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
    summary: "The low byte of BLTCON0, the minterms, on its own. ECS.",
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
      { bits: [15, 6], name: "H9–H0", text: "Height in lines (0 is 1024)" },
      { bits: [5, 0], name: "W5–W0", text: "Width in words (0 is 64)" },
    ],
  },
  {
    names: ["BLTSIZV"],
    summary: "Blitter height, up to 15 bits. ECS.",
  },
  {
    names: ["BLTSIZH"],
    summary: "Blitter width, up to 11 bits, and start. ECS.",
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
      { bits: [14, 12], name: "BPU2–BPU0", text: "Number of bitplanes, 0–6" },
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
      { bits: 3, name: "LPEN", text: "Light pen" },
      { bits: 2, name: "LACE", text: "Interlace" },
      {
        bits: 1,
        name: "ERSY",
        text: "External resync: sync pins become inputs",
      },
    ],
  },
  {
    names: ["BPLCON1"],
    summary:
      "Horizontal scroll for each playfield, 0–15 low-resolution pixels.",
    bits: [
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
      "Display priority: playfields against each other and against sprites.",
    bits: [
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
    summary: "Enhanced display features. ECS and AGA.",
  },
  {
    names: ["BPLxDAT"],
    summary:
      "Bitplane data, loaded by DMA. Writing BPL1DAT sends all six to the display, 16 pixels, leftmost first.",
  },
  {
    names: ["BPLxPTH", "BPLxPTL"],
    summary:
      "Bitplane address. Reload it every frame, from the Copper or in vertical blank.",
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
      "Colour palette entry, as 12-bit RGB: $0RGB, four bits per component.",
    bits: [
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
      "Sprite end line and control. Normally loaded by DMA; writing it disarms the sprite.",
    bits: [
      { bits: [15, 8], name: "EV7–EV0", text: "End line, low bits" },
      {
        bits: 7,
        name: "ATT",
        text: "Attach to the even sprite before it (odd sprites)",
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
    summary: "Sprite start position. Normally loaded by DMA.",
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
    summary: "Beam line high bit, and the long frame flag for interlace.",
    bits: [
      { bits: 15, name: "LOF", text: "Long frame" },
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
    .replace(/^BPL[1-6](DAT|PTH|PTL)$/, "BPLx$1")
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
  const docs = registerDocs.filter((d) => d.flags === prefix);
  const doc = docs[0];
  if (!doc?.bits) return undefined;
  const group = flagGroups[prefix]?.[flag];
  const bits = group
    ? doc.bits.filter(
        (bit) => typeof bit.bits === "number" && group.includes(bit.bits),
      )
    : doc.bits.filter(
        (bit) =>
          typeof bit.bits === "number" &&
          (bit.include ?? bit.name)?.toUpperCase() === flag,
      );
  // A bit number names one bit; only a mask can name several.
  if (!bits.length || (kind === "B" && bits.length > 1)) return undefined;
  return { docs, bits, bitNumber: kind === "B" };
}

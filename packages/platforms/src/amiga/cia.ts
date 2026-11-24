/**
 * The Amiga's two 8520 Complex Interface Adapters (CIAs).
 *
 * Facts from the Hardware Reference Manual's Appendix F, and the register and
 * flag names from the NDK's `hardware/cia.i`; the descriptions are our own.
 * CIA-A sits on the odd bytes at $BFEr01 and CIA-B on the even bytes at
 * $BFDr00, a register every $100, and both must be accessed a byte at a time.
 */

import type { RegisterBit, RegisterDoc } from "./register-docs.js";
import { HARDWARE_MANUAL_BASE } from "./manual-links.js";

/** Which CIA. */
export type Cia = "A" | "B";

/** Each CIA's base address, its first register, PRA. */
export const CIA_BASE: Readonly<Record<Cia, number>> = {
  A: 0xbfe001,
  B: 0xbfd000,
};

export interface CiaRegister {
  /** The manual's name for it, in upper case. */
  name: string;
  /** Offset from the CIA's base: the register number times $100. */
  offset: number;
  /** The name `hardware/cia.i` gives its offset, in lower case. */
  symbol: string;
}

export const ciaRegisters: readonly CiaRegister[] = (
  [
    ["PRA", "ciapra", 0x0],
    ["PRB", "ciaprb", 0x1],
    ["DDRA", "ciaddra", 0x2],
    ["DDRB", "ciaddrb", 0x3],
    ["TALO", "ciatalo", 0x4],
    ["TAHI", "ciatahi", 0x5],
    ["TBLO", "ciatblo", 0x6],
    ["TBHI", "ciatbhi", 0x7],
    ["TODLOW", "ciatodlow", 0x8],
    ["TODMID", "ciatodmid", 0x9],
    ["TODHI", "ciatodhi", 0xa],
    // Register $B is not connected.
    ["SDR", "ciasdr", 0xc],
    ["ICR", "ciaicr", 0xd],
    ["CRA", "ciacra", 0xe],
    ["CRB", "ciacrb", 0xf],
  ] as const
).map(([name, symbol, number]) => ({ name, symbol, offset: number * 0x100 }));

const bySymbol = new Map(ciaRegisters.map((r) => [r.symbol, r]));

/** The register `hardware/cia.i` names by a symbol, in any case: `ciapra`. */
export function ciaRegister(symbol: string): CiaRegister | undefined {
  return bySymbol.get(symbol.toLowerCase());
}

/**
 * The CIA a base symbol names, in any case: `ciaa` or `_ciaa` for CIA-A, as
 * `hardware/cia.i` has it for the second, or undefined.
 */
export function ciaBase(symbol: string): Cia | undefined {
  const match = /^_?cia([ab])$/i.exec(symbol);
  return match ? (match[1].toUpperCase() as Cia) : undefined;
}

const port = (bits: readonly [string, string, string][]): RegisterBit[] =>
  bits.map(([name, include, text], i) => ({
    bits: 7 - i,
    name,
    include,
    text,
  }));

const setClear: RegisterBit = {
  bits: 7,
  name: "S/C",
  include: "SETCLR",
  text: "1 sets the other bits written as 1, 0 clears them",
};

/**
 * Descriptions of the CIA registers. The port registers differ between the
 * two chips, so each has one for CIA-A and one for CIA-B.
 */
export const ciaDocs: readonly RegisterDoc[] = [
  {
    names: ["PRA"],
    cia: "A",
    width: 8,
    flags: "CIA",
    summary:
      "CIA-A port A: fire buttons, disk status, the power LED and the ROM overlay. The inputs read 0 when active.",
    bits: port([
      ["/FIR1", "GAMEPORT1", "Game port 1 fire button, 0 when pressed"],
      [
        "/FIR0",
        "GAMEPORT0",
        "Game port 0 fire button (the left mouse button), 0 when pressed",
      ],
      ["/RDY", "DSKRDY", "Disk ready, 0 when ready"],
      ["/TK0", "DSKTRACK0", "Disk head on track 0, when 0"],
      ["/WPRO", "DSKPROT", "Disk write protected, when 0"],
      ["/CHNG", "DSKCHANGE", "Disk changed, when 0"],
      ["/LED", "LED", "Power LED: 0 is bright"],
      ["OVL", "OVERLAY", "ROM overlay at address 0"],
    ]),
  },
  {
    names: ["PRB"],
    cia: "A",
    width: 8,
    summary: "CIA-A port B: the parallel port's data lines.",
  },
  {
    names: ["PRA"],
    cia: "B",
    width: 8,
    flags: "CIA",
    summary:
      "CIA-B port A: serial port handshake lines and parallel port status. Inputs marked / read 0 when active.",
    bits: port([
      ["/DTR", "COMDTR", "Serial Data Terminal Ready, output"],
      ["/RTS", "COMRTS", "Serial Request To Send, output"],
      ["/CD", "COMCD", "Serial Carrier Detect"],
      ["/CTS", "COMCTS", "Serial Clear To Send"],
      ["/DSR", "COMDSR", "Serial Data Set Ready"],
      ["SEL", "PRTRSEL", "Printer select"],
      ["POUT", "PRTRPOUT", "Printer paper out"],
      ["BUSY", "PRTRBUSY", "Printer busy"],
    ]),
  },
  {
    names: ["PRB"],
    cia: "B",
    width: 8,
    flags: "CIA",
    summary:
      "CIA-B port B: floppy drive control. Lines marked / are active at 0.",
    bits: port([
      ["/MTR", "DSKMOTOR", "Drive motor on, at 0"],
      ["/SEL3", "DSKSEL3", "Select external drive 3"],
      ["/SEL2", "DSKSEL2", "Select external drive 2"],
      ["/SEL1", "DSKSEL1", "Select external drive 1"],
      ["/SEL0", "DSKSEL0", "Select the internal drive"],
      ["/SIDE", "DSKSIDE", "Disk side select"],
      ["DIR", "DSKDIREC", "Step direction"],
      ["/STEP", "DSKSTEP", "Step the heads, on a pulse to 0"],
    ]),
  },
  {
    names: ["DDRA", "DDRB"],
    width: 8,
    summary:
      "Port A or B data direction: a 1 makes that bit of PRA or PRB an output. CIA-A's DDRA is normally $03, CIA-B's $FF.",
  },
  {
    names: ["TALO", "TAHI"],
    width: 8,
    summary:
      "Timer A, low and high bytes. Reads give the counter; writes set the latch it reloads from. It counts at the E clock, 709379 Hz PAL or 715909 Hz NTSC.",
  },
  {
    names: ["TBLO", "TBHI"],
    width: 8,
    summary:
      "Timer B, low and high bytes. Reads give the counter; writes set the latch it reloads from.",
  },
  {
    names: ["TODLOW", "TODMID", "TODHI"],
    width: 8,
    summary:
      "24-bit event counter, low, middle and high bytes: vertical blanks on CIA-A, horizontal syncs on CIA-B. Reading TODHI latches all three until TODLOW is read; writing stops it until TODLOW is written. With CRB's ALARM set, writes set the alarm.",
  },
  {
    names: ["SDR"],
    width: 8,
    summary:
      "Serial shift register: the keyboard on CIA-A, unused on CIA-B. CRA's SPMODE chooses input or output.",
  },
  {
    names: ["ICR"],
    width: 8,
    flags: "CIAICR",
    summary:
      "Interrupt control. Read, it gives the interrupts that have occurred, and clears them. Written, it sets or clears interrupt enables according to bit 7. CIA-A raises level 2 (PORTS), CIA-B level 6 (EXTER).",
    bits: [
      {
        ...setClear,
        text: "Written: 1 sets the enables written as 1, 0 clears them. Read: IR, an enabled interrupt occurred",
      },
      {
        bits: 4,
        name: "FLG",
        text: "FLAG pin: disk index on CIA-B, parallel acknowledge on CIA-A",
      },
      {
        bits: 3,
        name: "SP",
        text: "Serial port: a byte was shifted in or out",
      },
      { bits: 2, name: "ALRM", text: "Event counter reached the alarm" },
      { bits: 1, name: "TB", text: "Timer B underflow" },
      { bits: 0, name: "TA", text: "Timer A underflow" },
    ],
  },
  {
    names: ["CRA"],
    width: 8,
    flags: "CIACRA",
    summary: "Timer A control, and the serial port's direction.",
    bits: [
      {
        bits: 7,
        include: "TODIN",
        text: "Unused on the 8520 (TODIN in the includes, the 6526's 50/60 Hz select)",
      },
      {
        bits: 6,
        name: "SPMODE",
        text: "Serial port is an output; 0 is an input",
      },
      {
        bits: 5,
        name: "INMODE",
        text: "Count CNT pin edges; 0 counts the E clock",
      },
      {
        bits: 4,
        name: "LOAD",
        text: "Strobe: load the latch into the counter now",
      },
      { bits: 3, name: "RUNMODE", text: "One-shot; 0 is continuous" },
      { bits: 2, name: "OUTMODE", text: "PB6 output toggles; 0 pulses" },
      { bits: 1, name: "PBON", text: "Timer A output on PB6" },
      {
        bits: 0,
        name: "START",
        text: "Run; cleared on underflow in one-shot mode",
      },
    ],
  },
  {
    names: ["CRB"],
    width: 8,
    flags: "CIACRB",
    summary: "Timer B control, and whether event counter writes set the alarm.",
    bits: [
      {
        bits: 7,
        name: "ALARM",
        text: "Writes to the event counter set the alarm",
      },
      {
        bits: 6,
        name: "INMODE1",
        text: "Count timer A underflows (with INMODE0: only while CNT is high)",
      },
      {
        bits: 5,
        name: "INMODE0",
        text: "Count CNT pin edges; both clear counts the E clock",
      },
      {
        bits: 4,
        name: "LOAD",
        text: "Strobe: load the latch into the counter now",
      },
      { bits: 3, name: "RUNMODE", text: "One-shot; 0 is continuous" },
      { bits: 2, name: "OUTMODE", text: "PB7 output toggles; 0 pulses" },
      { bits: 1, name: "PBON", text: "Timer B output on PB7" },
      {
        bits: 0,
        name: "START",
        text: "Run; cleared on underflow in one-shot mode",
      },
    ],
  },
];

/**
 * The description of a CIA register, for the chip where known: both chips'
 * port registers differ, so without one a port register has two.
 */
export function ciaDocsFor(name: string, cia?: Cia): RegisterDoc[] {
  const upper = name.toUpperCase();
  return ciaDocs.filter(
    (doc) => doc.names.includes(upper) && (!cia || !doc.cia || doc.cia === cia),
  );
}

/** The Hardware Reference Manual's Appendix F pages, by the register they cover. */
const manualPages: Readonly<Record<string, string>> = {
  PRA: "node014A.html",
  PRB: "node014A.html",
  DDRA: "node0131.html",
  DDRB: "node0131.html",
  TALO: "node0133.html",
  TAHI: "node0133.html",
  TBLO: "node0133.html",
  TBHI: "node0133.html",
  TODLOW: "node013C.html",
  TODMID: "node013C.html",
  TODHI: "node013C.html",
  SDR: "node013E.html",
  ICR: "node0142.html",
  CRA: "node0146.html",
  CRB: "node0148.html",
};

/**
 * The Hardware Reference Manual's page on a CIA register, by name, or on the
 * CIAs as a whole for none: the address maps.
 */
export function ciaManualUrl(name?: string): string {
  return (
    HARDWARE_MANUAL_BASE +
    ((name && manualPages[name.toUpperCase()]) ?? "node012E.html")
  );
}

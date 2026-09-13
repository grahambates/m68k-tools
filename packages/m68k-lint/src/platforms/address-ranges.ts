import type { Platform } from "../core/config.js";

export interface ExpectedAbsoluteAddressRange {
  start: number;
  end: number;
  description: string;
}

/** Human-readable platform name for diagnostic text. */
export const platformLabels: Readonly<Record<Platform, string>> = {
  generic: "generic 68k",
  amiga: "Amiga",
  atari: "Atari",
};

/**
 * Atari hardware registers are conventionally written as a sign-extended
 * absolute short: `$FFFF8240.W` and `$FF8240` name the same register, because
 * the 68000 address bus is 24 bits wide and ignores A24-A31. Source may also
 * spell it as the negative word the encoding actually holds.
 *
 * One identifier covers the Atari family. Model-specific hardware - the STE's
 * DMA sound and blitter, the Mega STE's second MFP and SCC - sits inside the
 * same blocks, and splitting per model would only narrow the map, producing
 * false positives on code that targets a range of machines.
 */
const ATARI_RANGES: readonly ExpectedAbsoluteAddressRange[] = [
  {
    start: 0x000000,
    end: 0x0005ff,
    description: "68000 exception vectors and Atari system variables",
  },
  // One span from the memory controller through the end of the MFP register
  // file. It deliberately covers the gaps between blocks: this is a heuristic
  // for a missing '#', and no plausible intended immediate lands up here.
  {
    start: 0xff8000,
    end: 0xfffa3f,
    description: "Atari hardware registers: MMU, video, DMA, PSG, blitter, MFP",
  },
  {
    start: 0xfffa80,
    end: 0xfffabf,
    description: "Atari second MFP (Mega STE and TT)",
  },
  {
    start: 0xfffc00,
    end: 0xfffc07,
    description: "Atari keyboard and MIDI ACIAs",
  },
];

/**
 * Numeric absolute-address regions that are commonplace enough on a platform
 * that they should not trigger the missing-# footgun heuristic.
 *
 * This is intentionally a lint heuristic, not a complete platform memory map.
 */
export const expectedAbsoluteAddressRanges: Readonly<
  Record<Platform, readonly ExpectedAbsoluteAddressRange[]>
> = {
  generic: [],
  amiga: [
    {
      start: 0x000000,
      end: 0x0000bc,
      description: "68000 zero-page exception vectors",
    },
    { start: 0xbfd000, end: 0xbfefff, description: "Amiga CIA register space" },
    {
      start: 0xdff000,
      end: 0xdff1fc,
      description: "Amiga custom-chip registers",
    },
  ],
  atari: ATARI_RANGES,
};

/**
 * Address spellings that denote the same physical location on a 24-bit bus.
 *
 * `$FFFF8240`, `$FF8240` and `-32192` are all the same Atari register: the
 * first is the 32-bit sign-extension of the absolute short, the second is what
 * the 24-bit bus actually decodes, and the third is the signed word a source
 * file may contain.
 */
function addressAliases(address: number): readonly number[] {
  const unsigned = address >>> 0;
  const truncated = unsigned & 0xffffff;
  return unsigned === truncated ? [unsigned] : [unsigned, truncated];
}

export function expectedAbsoluteAddressRange(
  platform: Platform,
  address: number,
): ExpectedAbsoluteAddressRange | undefined {
  const ranges = expectedAbsoluteAddressRanges[platform];
  for (const candidate of addressAliases(address)) {
    const match = ranges.find(
      (range) => candidate >= range.start && candidate <= range.end,
    );
    if (match) return match;
  }
  return undefined;
}

/** Ranges rendered for diagnostic text, e.g. "$FF8201-$FFFA23 (Atari hardware registers)". */
export function describeExpectedRanges(platform: Platform): string {
  const hex = (value: number) =>
    `$${value.toString(16).toUpperCase().padStart(6, "0")}`;
  return expectedAbsoluteAddressRanges[platform]
    .map(
      (range) => `${hex(range.start)}-${hex(range.end)} (${range.description})`,
    )
    .join(", ");
}

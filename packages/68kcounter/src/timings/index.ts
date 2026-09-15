import { timings68040 } from "./tables68040";
import { timings68060 } from "./tables68060";
import { parseLine } from "m68k-parser";
import { baseTimes, lookupTimes, type TimingTable } from "./tables";
import * as cpu68020 from "./tables68020";
import * as cpu68030 from "./tables68030";
import {
  fullFormat,
  fullEaTiming,
  type FullForm,
  type EaKind,
} from "./ea68030";
import type { Timing2 } from "./tables68020";
import {
  Qualifiers,
  type AddressingMode,
  AddressingModes,
  Mnemonics,
  mnemonicGroups,
  type Mnemonic,
  type Cpu,
  Cpus,
  defaultCpu,
  type CacheModel,
  CacheModels,
  defaultCacheModel,
} from "../syntax";
import instructionQualifier from "../parse/instructionQualifier";
import { type InstructionStatement } from "../parse/nodes";
import evaluate, { type Variables } from "../parse/evaluate";

/**
 * Timing vector. The first element is always the clock count; the remaining
 * elements are bus-cycle counts shown in parentheses. The 68000 uses
 * `[clocks, reads, writes]`; the 68020/68030 use `[clocks, reads, prefetches, writes]`
 * (it separates operand reads from instruction-stream accesses). Helpers here
 * are length-agnostic so both shapes work.
 */
export type Timing = number[];

/**
 * Result of timing lookup for an instruction
 */
export interface InstructionTiming {
  values: Timing[];
  labels: string[];
  calculation?: Calculation;
  /** Separate totals for macro expansions containing different timing models. */
  groups?: TimingGroup[];
  /** Cached reference costs, not elapsed sequence timings or external DMA counts. */
  reference?: {
    cpu: "68040" | "68060";
    cache: "instruction-and-data";
    accesses: "operand";
    basis: "execution-stage" | "instruction-execution";
    note?: string;
    stages?: { calculate: number; executeLead: number; executeBase: number };
  };
}

export interface TimingGroup {
  model: string;
  min: Timing;
  max: Timing;
}

export function timingReferenceDescription(
  timing: InstructionTiming,
): string | undefined {
  const ref = timing.reference;
  if (!ref)
    return timing.groups
      ? timing.groups
          .map(
            (group) =>
              `${group.model}: ${formatTiming(group.min)}${group.min.some((n, i) => n !== group.max[i]) ? "–" + formatTiming(group.max) : ""}`,
          )
          .join("; ") + ". Reference sums, not elapsed sequence timings."
      : undefined;
  return `${ref.cpu} cached ${ref.basis === "execution-stage" ? "execution-stage" : "instruction"} reference: clocks(operand reads/writes). Both caches hit; accesses are not external bus transfers. No sequence overlap${ref.cpu === "68060" ? " or instruction pairing" : ""} is modelled.`;
}

/**
 * Describes how the timings are calculated
 */
export interface Calculation {
  /** Per-outcome uncached timings (68020 worst case; 68030 average case) */
  base: Timing[];
  /** Per-outcome timings for the instruction-cache-hit case (68020/68030) */
  baseCache?: Timing[];
  ea?: Timing;
  multiplier?: Timing;
  /** Known number or range */
  n?: number | [number, number];
}

export function popCount(x: number): number {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  x += x >> 8;
  x += x >> 16;
  return x & 0x7f;
}

/**
 * Look up timing information for a parsed instruction statement
 */
export function instructionTimings(
  statement: InstructionStatement,
  vars: Variables,
  cpu: Cpu = defaultCpu,
  cacheModel: CacheModel = defaultCacheModel,
): InstructionTiming | null {
  if (cpu === Cpus.MC68040) return timings68040(statement, vars);
  if (cpu === Cpus.MC68060) return timings68060(statement, vars);
  const forms: (FullForm | undefined)[] = [];
  const modes = statement.operands.map((operand) => operand.mode);
  if (cpu === Cpus.MC68030) {
    const parsed = parseLine(
      ` ${statement.opcode.op.text}${statement.opcode.qualifier ? `.${statement.opcode.qualifier.text}` : ""} ${statement.operands.map((operand) => operand.text).join(",")}`,
    );
    if (parsed.errors.length) return null;
    for (const [index, operand] of (parsed.value.operands ?? []).entries()) {
      const form = fullFormat(operand, vars);
      if (form === null) return null;
      forms[index] = form;
      if (form) {
        const pc =
          operand.type === "pc-relative" ||
          operand.type === "pc-relative-index" ||
          (operand.type === "memory-indirect" &&
            operand.baseRegister?.type === "symbol" &&
            operand.baseRegister.name.toLowerCase() === "pc");
        modes[index] = pc ? AddressingModes.PcDispIx : AddressingModes.AnDispIx;
      }
    }
  }
  const key = buildKey(statement, modes);
  const original = key ? timingMaps[cpu].get(key) : undefined;
  if (!original) return null;
  const calculation = { ...original };
  const lookup = eaLookups.get(original);
  for (const [index, form] of forms.entries()) {
    if (!form) continue;
    let previous: Timing2;
    let replacement: Timing2;
    if (lookup?.index === index) {
      previous = lookup.timing;
      replacement = fullEaTiming(form, lookup.kind);
    } else if (
      statement.opcode.op.name === Mnemonics.MOVE &&
      index === 1 &&
      modes[1] === AddressingModes.AnDispIx
    ) {
      // The MOVE destination is part of the operation table, not its source EA term.
      previous = [
        [6, 0, 0, 1],
        [7, 0, 1, 1],
      ];
      replacement = fullEaTiming(form, "move");
    } else {
      return null;
    }
    const adjust = (timing: Timing, cached: 0 | 1) =>
      timing.map((n, i) => n - previous[cached][i] + replacement[cached][i]);
    calculation.base = calculation.base.map((timing) => adjust(timing, 1));
    calculation.baseCache = calculation.baseCache?.map((timing) =>
      adjust(timing, 0),
    );
  }
  if (cpu === Cpus.MC68030 && statement.opcode.op.name === Mnemonics.MOVEC) {
    const control = statement.operands.find((operand) =>
      /^(?:sfc|dfc|cacr|usp|vbr|caar|msp|isp)$/i.test(operand.text),
    );
    if (!control) return null;
    if (
      control === statement.operands[1] &&
      /^(?:sfc|dfc|cacr)$/i.test(control.text)
    ) {
      calculation.base = [[12, 0, 1, 0]];
      calculation.baseCache = [[12, 0, 0, 0]];
    }
  }
  // Pick the cache-case or worst-case per-outcome timings (68020); the 68000
  // has no cache-case variant and always uses `base`.
  const selected =
    cacheModel === CacheModels.Cache && calculation.baseCache
      ? calculation.baseCache
      : calculation.base;
  const timings: Timing[] = [...selected];

  const {
    opcode: { op },
    operands,
  } = statement;
  const source = operands[0];

  // Calculate n multiplier:
  if (calculation.multiplier) {
    // Shift
    if (mnemonicGroups.SHIFT.includes(op.name)) {
      if (source.mode === AddressingModes.Imm) {
        calculation.n = evaluate(source.text, vars) ?? [1, 8];
      } else {
        // Range for register
        calculation.n = [0, 63];
      }
    }
    // MULU
    else if (op.name === Mnemonics.MULU) {
      // n = the number of ones in the <ea>
      const value = evaluate(source.text, vars);
      if (source.mode === AddressingModes.Imm && value !== undefined) {
        calculation.n = popCount(value);
      } else {
        calculation.n = [0, 16];
      }
    }
    // MULS
    else if (op.name === Mnemonics.MULS) {
      // n = concatenate the <ea> with a zero as the LSB;
      // n is the resultant number of 10 or 01 patterns in the 17-bit source;
      // i.e. worst case happens when the source is $5555
      const value = evaluate(source.text, vars);
      if (source.mode === AddressingModes.Imm && value !== undefined) {
        calculation.n = popCount((value ^ (value << 1)) & 0xffff);
      } else {
        calculation.n = [0, 16];
      }
    }
    // MOVEM
    else if (op.name === Mnemonics.MOVEM) {
      const listOperand = operands.find(
        (o) => o.mode === AddressingModes.RegList,
      );
      if (listOperand) {
        calculation.n = listOperand && rangeN(listOperand.text);
      } else {
        calculation.n = 1;
      }
    }

    // Apply multiplier:
    if (calculation.n) {
      // Range
      if (Array.isArray(calculation.n)) {
        for (const i in calculation.n) {
          const m = multiplyTiming(calculation.multiplier, calculation.n[i]);
          timings[i] = addTimings(selected[0], m);
        }
      }
      // Single value
      else {
        const m = multiplyTiming(calculation.multiplier, calculation.n);
        for (const i in timings) {
          timings[i] = addTimings(timings[i], m);
        }
      }
    }
  }

  // Add effective address lookup
  if (calculation.ea) {
    for (const i in timings) {
      timings[i] = addTimings(timings[i], calculation.ea);
    }
  }

  // Add labels for multiple values
  const labels = timings.length > 1 ? timingLabels(op.name) : [];

  return { values: timings, labels, calculation };
}

/**
 * Convert timing to string: clocks followed by the bus-cycle counts in
 * parentheses, e.g. `8(2/0)` (68000: read/write) or `9(1/0/0)` (68020:
 * read/prefetch/write).
 */
export const formatTiming = (timing: Timing): string =>
  `${timing[0]}(${timing.slice(1).join("/")})`;

/**
 * Add two timing vectors element-wise (padding the shorter with zeros).
 */
export function addTimings(a: Timing, b: Timing): Timing {
  const length = Math.max(a.length, b.length);
  const result: number[] = [];
  for (let i = 0; i < length; i++) {
    result[i] = (a[i] || 0) + (b[i] || 0);
  }
  return result;
}

/**
 * Multiply a timing vector by a scalar value
 */
export function multiplyTiming(t: Timing, scalar: number): Timing {
  return t.map((v) => v * scalar);
}

/**
 * Calculate timing n value from register range used in MOVEM
 */
export function rangeN(range: string): number {
  return range.split("/").reduce((acc, v) => {
    const [from, to] = v.split("-").map((n) => {
      const t = n[0].toUpperCase();
      return parseInt(n.substr(1), 10) + (t === "A" ? 8 : 0);
    });
    return acc + (to ? to - from + 1 : 1);
  }, 0);
}

/**
 * Get text labels for multiple timings
 */
export function timingLabels(op: Mnemonic): string[] {
  if ([...mnemonicGroups.SCC, ...mnemonicGroups.BCC].includes(op)) {
    return ["Taken", "Not taken"];
  }
  if (mnemonicGroups.DBCC.includes(op)) {
    return ["Taken", "Not taken", "Expired"];
  }
  if (op === Mnemonics.CHK) {
    return ["No trap", "Trap >", "Trap <"];
  }
  if (op === Mnemonics.TRAPV) {
    return ["No trap", "Trap"];
  }
  // Default
  return ["Min", "Max"];
}

/**
 * Build string key for map lookup
 */
function buildKey(
  statement: InstructionStatement,
  modes = statement.operands.map((operand) => operand.mode),
): string | null {
  const { opcode, operands } = statement;
  if (!opcode) {
    return null;
  }
  let key = opcode.op.name;
  const qualifier = instructionQualifier(statement);
  if (qualifier) {
    key += "." + qualifier;
  }
  if (operands.length) {
    key += " " + modes.join(",");
  }
  return key;
}

// Flatten a CPU's timing table into a key/value map for simple lookup by
// instruction string, e.g. "MOVE.L Dn,Dn": [4, 1, 0]
function buildTimingMap(
  baseTimes: TimingTable,
  lookupTimes: Record<string, [Timing, Timing]>,
): Map<string, Calculation> {
  const timingMap = new Map<string, Calculation>();

  for (const row of baseTimes) {
    const [mnemonics, qualifiers, operands, base, multiplier] = row;
    for (const mnemonic of mnemonics) {
      for (const qualifier of qualifiers) {
        let key = String(mnemonic);
        if (qualifier) {
          key += "." + qualifier;
        }
        const eaSize = qualifier === Qualifiers.L ? 1 : 0;
        let o: AddressingMode;

        if (Array.isArray(operands[0])) {
          // EA lookup in source
          for (o of operands[0]) {
            let k = key + " " + o;
            if (operands[1]) {
              k += "," + operands[1];
            }
            let ea: Timing | undefined;
            if (lookupTimes[o]) {
              ea = lookupTimes[o][eaSize];
              // Special cases:
              if (mnemonic === Mnemonics.TAS && o === AddressingModes.AbsW) {
                ea = [8, 1, 0];
              }
              if (
                (mnemonic === Mnemonics.TAS ||
                  mnemonic === Mnemonics.CHK ||
                  mnemonic === Mnemonics.MULS ||
                  mnemonic === Mnemonics.MULU) &&
                o === AddressingModes.AbsL
              ) {
                ea = [12, 2, 0];
              }
            }
            timingMap.set(k, { base, ea, multiplier });
          }
        } else if (Array.isArray(operands[1])) {
          // EA lookup in dest
          for (o of operands[1]) {
            const k = key + " " + operands[0] + "," + o;
            let ea: Timing | undefined;
            if (lookupTimes[o]) {
              ea = lookupTimes[o][eaSize];
            }
            timingMap.set(k, { base, ea, multiplier });
          }
        } else {
          // Regular operands
          if (operands.length) {
            key += " " + operands.join(",");
          }
          timingMap.set(key, { base, multiplier });
        }
      }
    }
  }

  return timingMap;
}

const eaLookups = new WeakMap<
  Calculation,
  { index: number; kind: EaKind; timing: Timing2 }
>();

// Build a cached-CPU lookup map. Each instruction has a cache-case and worst-case
// figure per outcome; the base tables exclude the effective-address time, which
// is folded in here per addressing mode (§8.2). The result stores per-outcome
// worst-case timings in `base` and cache-case timings in `baseCache`, and
// instructionTimings picks one according to the selected cache model.
function buildCachedMap(
  tables: typeof cpu68020 & { fetchEaLong?: typeof cpu68020.fetchEa },
): Map<string, Calculation> {
  const {
    baseTimes,
    moveTimes,
    fetchEa,
    calcEa,
    jumpEa,
    fetchImmEa,
    fetchImmEaL,
    calcImmEa,
  } = tables;
  const map = new Map<string, Calculation>();
  for (const [mnemonics, qualifiers, operands, timing, eaKind, multiplier] of [
    ...baseTimes,
    ...moveTimes,
  ]) {
    // Normalise to a list of outcomes, each a [cache, worst] pair.
    const outcomes: Timing2[] = Array.isArray(
      (timing as Timing2[] | Timing2)[0][0],
    )
      ? (timing as Timing2[])
      : [timing as Timing2];

    const eaIndex = operands.findIndex((o) => Array.isArray(o));
    const eaTable =
      eaKind === "calc"
        ? calcEa
        : eaKind === "jump"
          ? jumpEa
          : eaKind === "fetchImm"
            ? fetchImmEa
            : eaKind === "fetchImmL"
              ? fetchImmEaL
              : eaKind === "calcImm"
                ? calcImmEa
                : fetchEa;

    // Fold an optional EA time into each outcome and split into worst/cache.
    const entry = (ea?: Timing2): Calculation => {
      const calculation = {
        base: outcomes.map((o) => (ea ? addTimings(o[1], ea[1]) : o[1])),
        baseCache: outcomes.map((o) => (ea ? addTimings(o[0], ea[0]) : o[0])),
        multiplier,
      };
      if (ea)
        eaLookups.set(calculation, {
          index: eaIndex,
          kind: eaKind ?? "fetch",
          timing: ea,
        });
      return calculation;
    };

    for (const mnemonic of mnemonics) {
      for (const qualifier of qualifiers) {
        let key = String(mnemonic);
        if (qualifier) {
          key += "." + qualifier;
        }

        // No effective-address operand: timings apply directly.
        if (eaIndex === -1) {
          const k = operands.length ? key + " " + operands.join(",") : key;
          map.set(k, entry());
          continue;
        }

        // Expand over the effective-address modes, folding in the EA time.
        for (const mode of operands[eaIndex] as AddressingMode[]) {
          const ea =
            mode === AddressingModes.Imm &&
            qualifier === Qualifiers.L &&
            eaTable === fetchEa
              ? (tables.fetchEaLong ?? fetchEa)[mode]
              : eaTable[mode];
          if (!ea) {
            continue;
          }
          const modes = operands.map((o, i) => (i === eaIndex ? mode : o));
          map.set(key + " " + modes.join(","), entry(ea));
        }
      }
    }
  }
  return map;
}

const timingMaps: Record<
  Exclude<Cpu, "68040" | "68060">,
  Map<string, Calculation>
> = {
  [Cpus.MC68000]: buildTimingMap(baseTimes, lookupTimes),
  [Cpus.MC68020]: buildCachedMap(cpu68020),
  [Cpus.MC68030]: buildCachedMap(cpu68030),
};

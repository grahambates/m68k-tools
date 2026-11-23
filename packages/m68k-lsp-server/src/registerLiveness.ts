import type { RegisterAvailability } from "@m68k-lsp/protocol";
import {
  type BlockStructure,
  enclosingBlocks,
  type ParsedFile,
} from "m68k-parser";
import type * as lsp from "vscode-languageserver";
import type { Context } from "./context";
import {
  createAliasResolver,
  lineSteps,
  type LineSteps,
} from "./registerEffects";
import { createFlowGraph } from "./registerFlow";
import {
  collectMacroDefinitionLines,
  generalPurposeRegisters,
} from "./registerSource";
import { findStackSaves } from "./registerStack";

/**
 * Lines in the scope that leave a register alone while its value is not
 * needed, or might not be, in order. `untilOverwritten` marks free lines where
 * it stays free only until a later write replaces it.
 */
export type AvailabilityLines = {
  line: number;
  availability: "available" | "unknown";
  untilOverwritten: boolean;
}[];

interface RegisterLiveness {
  /** Whether the register is free after the position's line. */
  availability: RegisterAvailability;
  /** Free only until a later write replaces it, not to the end of the flow. */
  untilOverwritten?: true;
  lines: AvailabilityLines;
}

/**
 * Which registers are free to reuse after a position, and where in the scope
 * each is free: no bit of its value is read again, on any path the flow can
 * take, before something overwrites that bit. Worked out as backward liveness
 * over the flow graph of the scope and everything reachable from it, tracking
 * how many low-order bits are still needed (see `accessBits`), so a word write
 * frees a register that is only read as a word afterwards.
 *
 * At the cursor, flow starts from wherever the cursor line's own instruction
 * goes, so a loop's closing branch leads back into the loop. A path ends at a
 * return, which reads the outputs the block's header documents. After a
 * branch whose target cannot be resolved, any register may be needed, so none
 * is known to be free.
 *
 * Calls to subroutines in the file are followed through the subroutine, its
 * returns needing what the caller needs afterwards, recursion included. One
 * defined elsewhere is taken at its header's word: inputs are read, outputs
 * and trashed registers overwritten, and other registers kept. A call with
 * neither may do anything. All registers are worked out together, as masks
 * (see `NeedTable`), in one pass over the scope and every subroutine it
 * calls. If that is more work than `FLOW_WORK_LIMIT` allows, calls are not
 * followed, and every subroutine is taken at its header's word.
 */
export function registerLiveness(
  ctx: Context,
  uri: string,
  file: ParsedFile,
  blocks: BlockStructure,
  lineTexts: string[],
  scope: lsp.Range,
  position: lsp.Position,
  outputs: ReadonlySet<string>,
  calleeContract: (name: string) => RoutineContract | undefined,
): LivenessAnalysis {
  const { lines } = file;
  const macroDefinitionLines = collectMacroDefinitionLines(blocks.blocks);
  const aliases = createAliasResolver(ctx, uri);
  const saves = findStackSaves(file, blocks, aliases);
  const nodeAt = createFlowGraph(file, blocks, ctx, uri, lineTexts);

  const stepsFor = (index: number): LineSteps =>
    lineSteps(
      ctx,
      uri,
      lines[index],
      lineTexts[index] ?? "",
      macroDefinitionLines.has(index),
      enclosingBlocks(blocks, index).some(
        (block) => block.kind === "conditional",
      ),
      aliases,
    );

  const contracts = new Map<string, CallMasks>();
  const contractMasks = (name: string | undefined): CallMasks => {
    if (name === undefined) {
      return UNKNOWN_CALL;
    }
    let masks = contracts.get(name);
    if (!masks) {
      const contract = calleeContract(name);
      masks = contract ? contractCallMasks(contract) : UNKNOWN_CALL;
      contracts.set(name, masks);
    }
    return masks;
  };

  const endLine = Math.min(scope.end.line, lines.length - 1);
  const scopeLines: number[] = [];
  for (let index = scope.start.line; index <= endLine; index++) {
    scopeLines.push(index);
  }

  const flow =
    analyseFlow(true) ??
    // Without following calls, the flow is only the scope's own, and the
    // work is bounded by it.
    analyseFlow(false)!;

  /**
   * The flow from the scope, and from every subroutine it calls when calls
   * are followed: what each line does, and the needs and registers touched
   * from each, settled. Undefined if settling needs more than the limit.
   */
  function analyseFlow(followCalls: boolean): FlowAnalysis | undefined {
    const slots = new Int32Array(lines.length).fill(-1);
    const region: LineCode[] = [];
    const pending = [...scopeLines];
    while (pending.length) {
      const index = pending.pop()!;
      if (index >= lines.length || slots[index] >= 0) {
        continue;
      }
      slots[index] = region.length;
      const code = compileLine(index, followCalls);
      region.push(code);
      pending.push(...code.next);
      if (code.callee !== undefined) {
        pending.push(code.callee);
      }
    }

    // What to recompute when a line's entry changes: the lines that flow
    // into it, the calls to it, and saves whose restores flow into it.
    const dependents: number[][] = region.map(() => []);
    region.forEach((code, slot) => {
      for (const next of code.next) {
        dependents[slots[next]].push(slot);
      }
      if (code.callee !== undefined) {
        dependents[slots[code.callee]].push(slot);
      }
      for (let item = 1; item < code.restores.length; item += 2) {
        for (const next of nodeAt(code.restores[item]).next) {
          if (slots[next] >= 0) {
            dependents[slots[next]].push(slot);
          }
        }
      }
    });
    // Later lines first, as needs flow backwards.
    const order = region
      .map((_, slot) => slot)
      .sort((a, b) => region[b].line - region[a].line);
    const settle = (update: (slot: number) => boolean, limit = Infinity) => {
      const queue = [...order];
      const queued = new Uint8Array(region.length).fill(1);
      for (let head = 0; head < queue.length; head++) {
        if (head >= limit) {
          return false;
        }
        const slot = queue[head];
        queued[slot] = 0;
        if (update(slot)) {
          for (const dependent of dependents[slot]) {
            if (!queued[dependent]) {
              queued[dependent] = 1;
              queue.push(dependent);
            }
          }
        }
      }
      return true;
    };

    const needs = new Int32Array(region.length * NEED_TABLE_SIZE);
    const after = new Int32Array(NEED_TABLE_SIZE);
    const restored = new Int32Array(NEED_TABLE_SIZE);
    const updated = new Int32Array(NEED_TABLE_SIZE);
    const needsOut = (next: number[], exit: boolean, into: Int32Array) => {
      if (exit) {
        into.set(EXIT_NEEDS);
      } else {
        into.fill(0);
      }
      for (const line of next) {
        const base = slots[line] * NEED_TABLE_SIZE;
        if (base < 0) {
          continue;
        }
        for (let item = 0; item < NEED_TABLE_SIZE; item++) {
          into[item] |= needs[base + item];
        }
      }
    };
    const updateNeeds = (slot: number): boolean => {
      const code = region[slot];
      if (code.escape) {
        // Where a jump that could go anywhere leads, any register may be
        // needed; that is not known to be so. Its own operands are read as
        // usual.
        after.set(ESCAPE_NEEDS);
      } else {
        needsOut(code.next, code.exit, after);
      }
      // The call runs after the line's operands are evaluated.
      if (code.callee !== undefined) {
        applyNeeds(needs, slots[code.callee] * NEED_TABLE_SIZE, after);
      } else if (code.call) {
        callNeeds(code.call, after);
      }
      stepNeeds(code.steps, after);
      // A saved register's value is kept on the stack, not read: whatever is
      // needed once it is restored is needed before it is saved.
      for (let item = 0; item < code.restores.length; item += 2) {
        const bit = code.restores[item];
        const restore = nodeAt(code.restores[item + 1]);
        needsOut(restore.next, restore.exit, restored);
        for (let index = 0; index < NEED_TABLE_SIZE; index++) {
          after[index] |= restored[index] & bit;
        }
      }
      // Needs only rise, which keeps the fixed point the least one.
      const base = slot * NEED_TABLE_SIZE;
      let changed = false;
      for (let item = 0; item < NEED_TABLE_SIZE; item++) {
        updated[item] = after[item] | needs[base + item];
        changed ||= updated[item] !== needs[base + item];
      }
      needs.set(updated, base);
      return changed;
    };
    // Only following calls is limited: the fallback, the scope's own flow, has
    // to finish, as there is nothing further to fall back to.
    if (!settle(updateNeeds, followCalls ? flowWorkLimit : Infinity)) {
      return;
    }

    // Registers the code from each line may touch or change as a caller sees
    // it, and those code that could not be analysed may change. Changes a
    // stack restore undoes do not count.
    const visible = new Int32Array(region.length * 3);
    settle((slot) => {
      const code = region[slot];
      let touched = code.touchedVisibly;
      let modified = code.modifiedVisibly;
      let uncertain = code.uncertain;
      const kept = ALL_REGISTERS & ~code.covered;
      if (code.callee !== undefined) {
        const callee = slots[code.callee] * 3;
        touched |= visible[callee] & kept;
        modified |= visible[callee + 1] & kept;
        uncertain |= visible[callee + 2] & kept;
      }
      for (const next of code.next) {
        touched |= visible[slots[next] * 3];
        modified |= visible[slots[next] * 3 + 1];
        uncertain |= visible[slots[next] * 3 + 2];
      }
      const base = slot * 3;
      if (
        touched === visible[base] &&
        modified === visible[base + 1] &&
        uncertain === visible[base + 2]
      ) {
        return false;
      }
      visible.set([touched, modified, uncertain], base);
      return true;
    });

    // Registers a line does anything to, or might, and those anything from
    // it on along its own flow does.
    const touches = region.map((code) =>
      code.callee === undefined
        ? code.touches
        : code.touches |
          visible[slots[code.callee] * 3] |
          visible[slots[code.callee] * 3 + 2],
    );
    const touchedIn = new Int32Array(region.length);
    settle((slot) => {
      let touched = touches[slot];
      for (const next of region[slot].next) {
        touched |= touchedIn[slots[next]];
      }
      if (touched === touchedIn[slot]) {
        return false;
      }
      touchedIn[slot] = touched;
      return true;
    });

    return { slots, needs, needsOut, visible, touches, touchedIn };
  }

  /** What a line does, as the flow analysis uses it (see `LineCode`). */
  function compileLine(index: number, followCalls: boolean): LineCode {
    const node = nodeAt(index);
    const covered = registerMask(saves.coveredAt(index));
    const saved = saves.restoresAt(index);
    const restoring = registerMask(saved?.keys() ?? []);
    const restores: number[] = [];
    for (const [register, restoreLines] of saved ?? []) {
      for (const restore of restoreLines) {
        restores.push(registerBit(register), restore);
      }
    }
    const kept = ALL_REGISTERS & ~covered;
    const code: LineCode = {
      line: index,
      next: node.next,
      exit: node.exit,
      escape: node.escape,
      steps: [],
      restores,
      covered,
      touches: node.escape ? ALL_REGISTERS : 0,
      touchedVisibly: 0,
      modifiedVisibly: 0,
      // A jump that could go anywhere is code that could not be analysed,
      // which may do anything to a register, except one a stack save around
      // it will put back.
      uncertain: node.escape ? kept : 0,
    };
    for (const step of stepsFor(index)) {
      if (step === "unknown") {
        code.steps.push(0, 0, 0, 0, 0, 0, 1);
        code.touches = ALL_REGISTERS;
        code.uncertain |= kept;
        continue;
      }
      let write8 = 0;
      let write16 = 0;
      let write32 = 0;
      let read8 = 0;
      let read16 = 0;
      let read32 = 0;
      for (const [register, effect] of step) {
        const bit = registerBit(register);
        code.touches |= bit;
        if (effect.write === 8) {
          write8 |= bit;
        } else if (effect.write === 16) {
          write16 |= bit;
        } else if (effect.write === 32) {
          write32 |= bit;
        }
        if (effect.read && !(restoring & bit)) {
          read8 |= bit;
          read16 |= effect.read >= 16 ? bit : 0;
          read32 |= effect.read >= 32 ? bit : 0;
        }
        // A save keeps the caller's value, and what happens to the register
        // before a restore puts it back is not seen by the caller.
        if (!(covered & bit) && !(restoring & bit)) {
          code.touchedVisibly |= bit;
          code.modifiedVisibly |= effect.modifies ? bit : 0;
        }
      }
      code.steps.push(write8, write16, write32, read8, read16, read32, 0);
    }
    if (node.call) {
      if (node.call.line !== undefined && followCalls) {
        code.callee = node.call.line;
      } else {
        const call = contractMasks(node.call.name);
        code.call = call;
        code.touches |= call.named;
        code.touchedVisibly |= call.named & kept;
        code.modifiedVisibly |= call.writes & kept;
        code.uncertain |= call.unknown ? kept : 0;
      }
    }
    return code;
  }

  const registerNeed = (
    table: ArrayLike<number>,
    base: number,
    register: string,
  ): Need => {
    const bit = registerBit(register);
    // The need where the flow leaves: outputs are read on return.
    const offset = base + (outputs.has(register) ? ALL_NEED_CODE : 0) * 4;
    return {
      bits:
        table[offset + 2] & bit
          ? 32
          : table[offset + 1] & bit
            ? 16
            : table[offset] & bit
              ? 8
              : 0,
      unknown: !!(table[offset + 3] & bit),
    };
  };
  const needIn = (line: number, register: string): Need => {
    const slot = flow.slots[line];
    return slot < 0
      ? NONE
      : registerNeed(flow.needs, slot * NEED_TABLE_SIZE, register);
  };
  const out = new Int32Array(NEED_TABLE_SIZE);
  const needOut = (line: number, register: string): Need => {
    const node = nodeAt(line);
    flow.needsOut(node.next, node.exit, out);
    return registerNeed(out, 0, register);
  };
  const touchedIn = (line: number, bit: number) =>
    flow.slots[line] >= 0 && !!(flow.touchedIn[flow.slots[line]] & bit);
  const touchedOut = (line: number, bit: number) =>
    nodeAt(line).next.some((next) => touchedIn(next, bit));

  const availability = (register: string): RegisterLiveness => {
    const bit = registerBit(register);
    const status = (need: Need) =>
      need.bits ? "unavailable" : need.unknown ? "unknown" : "available";

    // Lines that leave the register alone while its value is not needed, or
    // where that depends on code that could not be analysed.
    const free: AvailabilityLines = [];
    for (const index of scopeLines) {
      const need = status(needIn(index, register));
      if (need !== "unavailable" && !(flow.touches[flow.slots[index]] & bit)) {
        free.push({
          line: index,
          availability: need,
          untilOverwritten: need === "available" && touchedOut(index, bit),
        });
      }
    }

    // At the cursor, what matters is what happens after its line runs.
    let need: Need;
    let touched: boolean;
    if (position.line > endLine) {
      need = NONE;
      touched = false;
    } else if (position.line < scope.start.line) {
      need = needIn(scope.start.line, register);
      touched = touchedIn(scope.start.line, bit);
    } else {
      need = needOut(position.line, register);
      touched = touchedOut(position.line, bit);
    }
    const availability = status(need);
    return {
      availability,
      ...(availability === "available" && touched
        ? { untilOverwritten: true }
        : {}),
      lines: free,
    };
  };
  return {
    availability,
    modifiedFrom: (line) => {
      const slot = flow.slots[line];
      const modified = slot < 0 ? 0 : flow.visible[slot * 3 + 1];
      const uncertain = slot < 0 ? 0 : flow.visible[slot * 3 + 2];
      return {
        registers: new Set(maskRegisters(modified)),
        uncertain: new Set(maskRegisters(uncertain)),
        unknown: uncertain !== 0,
      };
    },
  };
}

/**
 * Registers as a mask, a bit for each general-purpose register in the order
 * D0–D7, A0–A7.
 */
const registerBits = new Map(
  [...generalPurposeRegisters].map((register, index) => [register, 1 << index]),
);

const ALL_REGISTERS = 0xffff;

function registerBit(register: string): number {
  return registerBits.get(register) ?? 0;
}

function registerMask(registers: Iterable<string>): number {
  let mask = 0;
  for (const register of registers) {
    mask |= registerBit(register);
  }
  return mask;
}

function maskRegisters(mask: number): string[] {
  return [...generalPurposeRegisters].filter(
    (register) => mask & registerBit(register),
  );
}

/**
 * The needs of every register on entry to a line (see `Need`), for each need
 * every register might have where the flow leaves: a return, or the end of
 * the file. Because each register's need on entry depends only on its own
 * need on leaving, the entry for a subroutine's first line is its summary,
 * whatever each register is needed for after the call.
 *
 * There is an entry for each need, by its code: twice its byte, word or long
 * word level (0 for none, 1 to 3), plus 1 if code that could not be analysed
 * may read it. Each entry is four register masks: registers needing at least
 * the low byte, at least the word, all 32 bits, and those code that could not
 * be analysed may read.
 */
type NeedTable = Int32Array;

const NEED_CODES = 8;

const NEED_TABLE_SIZE = NEED_CODES * 4;

/** The code of `ALL`, needing all 32 bits. */
const ALL_NEED_CODE = 6;

/** Each register needing what its entry stands for where the flow leaves. */
const EXIT_NEEDS: NeedTable = new Int32Array(NEED_TABLE_SIZE).map((_, item) => {
  const code = item >> 2;
  const level = code >> 1;
  switch (item & 3) {
    case 0:
      return level >= 1 ? ALL_REGISTERS : 0;
    case 1:
      return level >= 2 ? ALL_REGISTERS : 0;
    case 2:
      return level >= 3 ? ALL_REGISTERS : 0;
    default:
      return code & 1 ? ALL_REGISTERS : 0;
  }
});

/** Any register may be needed, which is not known to be so. */
const ESCAPE_NEEDS: NeedTable = new Int32Array(NEED_TABLE_SIZE).map(
  (_, item) => ((item & 3) === 3 ? ALL_REGISTERS : 0),
);

/**
 * The needs before a call to a subroutine whose needs on entry are in a
 * table, given the needs once it returns: each register's need on entry for
 * its own need after the call.
 */
function applyNeeds(table: NeedTable, base: number, after: NeedTable) {
  for (let entry = 0; entry < NEED_TABLE_SIZE; entry += 4) {
    const byte = after[entry];
    const word = after[entry + 1];
    const long = after[entry + 2];
    const unknown = after[entry + 3];
    let result0 = 0;
    let result1 = 0;
    let result2 = 0;
    let result3 = 0;
    const levels = [ALL_REGISTERS & ~byte, byte & ~word, word & ~long, long];
    for (let level = 0; level < 4; level++) {
      for (let flag = 0; flag < 2; flag++) {
        const registers =
          levels[level] & (flag ? unknown : ALL_REGISTERS & ~unknown);
        if (registers) {
          const source = base + (level * 2 + flag) * 4;
          result0 |= table[source] & registers;
          result1 |= table[source + 1] & registers;
          result2 |= table[source + 2] & registers;
          result3 |= table[source + 3] & registers;
        }
      }
    }
    after[entry] = result0;
    after[entry + 1] = result1;
    after[entry + 2] = result2;
    after[entry + 3] = result3;
  }
}

/** The needs before a call taken at its header's word, given those after. */
function callNeeds(call: CallMasks, after: NeedTable) {
  // Inputs are read whole, outputs and trashed registers overwritten, and
  // others kept.
  const kept = ALL_REGISTERS & ~call.reads & ~call.writes;
  for (let entry = 0; entry < NEED_TABLE_SIZE; entry += 4) {
    if (call.unknown) {
      after[entry + 3] = ALL_REGISTERS;
      continue;
    }
    after[entry] = (after[entry] & kept) | call.reads;
    after[entry + 1] = (after[entry + 1] & kept) | call.reads;
    after[entry + 2] = (after[entry + 2] & kept) | call.reads;
    after[entry + 3] &= kept;
  }
}

/**
 * The needs before a line's steps, given those after them. Each step is
 * seven numbers: the registers it writes a byte, word and long word of, those
 * it reads at least a byte, word and long word of, and 1 for code that could
 * not be analysed, which may read any register.
 */
function stepNeeds(steps: number[], after: NeedTable) {
  for (let step = steps.length - 7; step >= 0; step -= 7) {
    for (let entry = 0; entry < NEED_TABLE_SIZE; entry += 4) {
      if (steps[step + 6]) {
        after[entry + 3] = ALL_REGISTERS;
        continue;
      }
      // A write leaves the earlier value unneeded once it replaces every
      // bit still to be read; otherwise the bits it keeps carry the old
      // value.
      const freed =
        steps[step + 2] |
        (steps[step + 1] & ~after[entry + 2]) |
        (steps[step] & ~after[entry + 1]);
      after[entry] = (after[entry] & ~freed) | steps[step + 3];
      after[entry + 1] = (after[entry + 1] & ~freed) | steps[step + 4];
      after[entry + 2] = (after[entry + 2] & ~freed) | steps[step + 5];
      after[entry + 3] &= ~freed;
    }
  }
}

/** A call to a subroutine that is not followed, as register masks. */
interface CallMasks {
  /** Registers its header says it reads. */
  reads: number;
  /** Registers its header says it overwrites. */
  writes: number;
  /** Registers its header mentions. */
  named: number;
  /** It has no header to go by, so it may do anything. */
  unknown: boolean;
}

const UNKNOWN_CALL: CallMasks = {
  reads: 0,
  writes: 0,
  named: ALL_REGISTERS,
  unknown: true,
};

function contractCallMasks(contract: RoutineContract): CallMasks {
  const masks: CallMasks = { reads: 0, writes: 0, named: 0, unknown: false };
  for (const [register, { reads, writes }] of contract) {
    const bit = registerBit(register);
    masks.named |= bit;
    masks.reads |= reads ? bit : 0;
    masks.writes |= writes ? bit : 0;
  }
  return masks;
}

/** What a line does, for the flow analysis, as register masks. */
interface LineCode {
  line: number;
  next: number[];
  exit: boolean;
  escape: boolean;
  /** The subroutine it calls, followed through its own flow. */
  callee?: number;
  /** A call it makes that is not followed. */
  call?: CallMasks;
  /** Its steps in execution order (see `stepNeeds`). */
  steps: number[];
  /** Pairs of a register it saves and a line restoring it. */
  restores: number[];
  /** Registers a stack save around it puts back. */
  covered: number;
  /** Registers it does anything to, or might, not counting its callee. */
  touches: number;
  /** Registers it touches, and changes, as a caller sees them. */
  touchedVisibly: number;
  modifiedVisibly: number;
  /** Registers code here that could not be analysed may change. */
  uncertain: number;
}

/** The settled flow of a scope (see `registerLiveness`). */
interface FlowAnalysis {
  /** Each line's place in the tables below, or -1 where flow never goes. */
  slots: Int32Array;
  /** The needs on entry to each line. */
  needs: NeedTable;
  /** The needs after a line with some successors, into a table. */
  needsOut(next: number[], exit: boolean, into: NeedTable): void;
  /**
   * Registers the code from each line may touch, may change, and may change
   * through code that could not be analysed, as a caller sees them.
   */
  visible: Int32Array;
  /** Registers each line does anything to, or might, its callee included. */
  touches: number[];
  /** Registers anything from each line on, along its own flow, touches. */
  touchedIn: Int32Array;
}

/**
 * Lines the flow analysis may work through, counting each time a line's
 * needs are worked out again, before it gives up following calls. Following
 * every call in a large program, where many routines call each other, can
 * reach tens of thousands of lines; past this, a few tenths of a second,
 * calls are taken at their headers' word instead.
 */
const FLOW_WORK_LIMIT = 1_000_000;

let flowWorkLimit = FLOW_WORK_LIMIT;

/**
 * Overrides `FLOW_WORK_LIMIT`, so tests can go past it without a program large
 * enough to take that long. Returns a function restoring the previous limit.
 */
export function setFlowWorkLimit(limit: number): () => void {
  const previous = flowWorkLimit;
  flowWorkLimit = limit;
  return () => {
    flowWorkLimit = previous;
  };
}

/**
 * Registers found in some code, and whether code that could not be analysed
 * may involve others.
 */
interface CodeRegisters {
  registers: Set<string>;
  /** Registers code that could not be analysed may involve. */
  uncertain: Set<string>;
  unknown: boolean;
}

/** Register liveness over a scope, and what routines in the file do. */
interface LivenessAnalysis {
  /** A register's availability at the position, and where it is free. */
  availability(register: string): RegisterLiveness;
  /**
   * Registers the code from a line may leave changed when it returns,
   * following its calls, and those code that could not be analysed, such as
   * a jump that could go anywhere, may change.
   */
  modifiedFrom(line: number): CodeRegisters;
}

/**
 * How much of a register's value is needed: the number of low-order bits
 * later code reads, and whether code that could not be analysed might read
 * it.
 */
interface Need {
  bits: number;
  unknown: boolean;
}

const NONE: Need = { bits: 0, unknown: false };

/**
 * What a routine's header says it does with registers, for calls to routines
 * that cannot be analysed here: which it reads, and which it overwrites.
 * Registers it does not mention are kept.
 */
export type RoutineContract = ReadonlyMap<
  string,
  { reads: boolean; writes: boolean }
>;

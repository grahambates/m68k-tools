import type {
  RegisterAccess,
  RegisterAvailabilityRange,
  RegisterRangesResult,
  RegisterUsage,
  RegisterUsageParams,
  RegisterUsageReference,
  RegisterUsageResult,
} from "@m68k-lsp/protocol";
import { locationAsRange, type ParsedLine } from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { walkFile, walkLine } from "./ast";
import type { Context } from "./context";
import { isProcessed } from "./DocumentProcessor";
import { findMacroDefinition } from "./macros";
import {
  type AliasResolver,
  createAliasResolver,
  definesRegisters,
  registerAccess,
  registerName,
  registersAt,
} from "./registerEffects";
import {
  type AvailabilityLines,
  registerLiveness,
  type RoutineContract,
} from "./registerLiveness";
import { findBlockRange } from "./registerScope";
import {
  collectMacroDefinitionLines,
  comparePositions,
  type ExpandedLine,
  expandMacroCall,
  generalPurposeRegisters,
  literalRegisterSpan,
  rangesOverlap,
  sourceRangeForLocation,
} from "./registerSource";
import { findStackSaves } from "./registerStack";

export {
  isNonLocalCodeLabel,
  undefinedMacroCalls,
  canonicalGeneralPurposeRegister,
} from "./registerSource";
export { type FlowCall, type FlowNode, createFlowGraph } from "./registerFlow";
export { registerName, createAliasResolver } from "./registerEffects";
export { type StackSaves, findStackSaves } from "./registerStack";
export { findBlockRange } from "./registerScope";
export { setFlowWorkLimit, type RoutineContract } from "./registerLiveness";

export function analyzeRegisterUsage(
  ctx: Context,
  params: RegisterUsageParams,
  options: {
    /** Registers the block's header documents as outputs, needed at a return. */
    outputs?: ReadonlySet<string>;
    /** What a called routine that is not in this file does, if documented. */
    calleeContract?: (name: string) => RoutineContract | undefined;
  } = {},
): RegisterUsageResult | undefined {
  const document = ctx.store.get(params.textDocument.uri);
  if (!isProcessed(document)) {
    return;
  }

  const usages = new Map<string, RegisterUsageReference[]>();
  const aliases = createAliasResolver(ctx, params.textDocument.uri);
  const saves = findStackSaves(document.parsed, document.blocks, aliases);
  let incomplete = false;
  const { lines } = document.parsed;
  const firstLine = Math.max(params.range.start.line, 0);
  const lastLine = Math.min(params.range.end.line, lines.length - 1);
  for (let index = firstLine; index <= lastLine; index++) {
    const line = lines[index];
    if (
      definesRegisters(line) ||
      (line.mnemonic?.type === "macro" &&
        findMacroDefinition(line.mnemonic.macro, params.textDocument.uri, ctx))
    ) {
      continue;
    }
    for (const node of walkLine(line)) {
      for (const found of registersAt(node, aliases)) {
        const range = locationAsRange(found.node.loc);
        if (!rangesOverlap(params.range, range)) {
          continue;
        }
        const reference: RegisterUsageReference = {
          range,
          spelling: document.document.getText(range),
          kind: found.kind,
          access: registerAccess(found.node, line),
        };
        for (const register of found.registers) {
          addReference(usages, register, reference);
        }
      }
    }
  }

  const lineTexts = document.document.getText().split(/\r?\n/g);
  const macroDefinitionLines = collectMacroDefinitionLines(
    document.blocks.blocks,
  );
  for (let index = firstLine; index <= lastLine; index++) {
    const line = lines[index];
    if (line.mnemonic?.type !== "macro" || macroDefinitionLines.has(index)) {
      continue;
    }
    const callRange = locationAsRange(line.mnemonic.loc);
    if (!rangesOverlap(params.range, callRange)) {
      continue;
    }
    const expansion = expandMacroCall(
      ctx,
      params.textDocument.uri,
      line,
      lineTexts[index] ?? "",
    );
    if (!expansion) {
      continue;
    }
    for (const expanded of expansion.lines)
      addExpandedRegisters(expanded.line, expanded, callRange, usages, aliases);
    incomplete ||= expansion.incomplete;
  }

  const liveness = params.position
    ? registerLiveness(
        ctx,
        params.textDocument.uri,
        document.parsed,
        document.blocks,
        lineTexts,
        params.range,
        params.position,
        options.outputs ?? new Set(),
        options.calleeContract ?? (() => undefined),
      )
    : undefined;
  return {
    documentVersion: document.document.version,
    ...(incomplete ? { incomplete: true } : {}),
    registers: Array.from(usages, ([name, references]) => {
      const usage = summariseUsage(
        name,
        references,
        (line) =>
          saves.restoresOf(line, name) !== undefined ||
          saves.saveOf(line, name) !== undefined,
      );
      if (liveness) {
        const { availability, untilOverwritten, lines } =
          liveness.availability(name);
        usage.availability = availability;
        if (untilOverwritten) {
          usage.availableUntilOverwritten = true;
        }
        if (lines.length) {
          usage.availabilityRanges = lineRuns(lines, (index) => {
            const type = document.parsed.lines[index]?.mnemonic?.type;
            return type === "instruction" || type === "macro";
          });
        }
      }
      return usage;
    }),
  };
}

export function registerRanges(
  ctx: Context,
  uri: string,
): RegisterRangesResult {
  const document = ctx.store.get(uri);
  if (!isProcessed(document)) {
    return {};
  }

  const ranges: RegisterRangesResult = {};
  for (const { node } of walkFile(document.parsed)) {
    const register = registerName(node);
    if (register) {
      (ranges[register] ??= []).push(locationAsRange(node.loc));
    }
  }
  return ranges;
}

/**
 * Consecutive lines of the same kind as ranges, each from the start of its
 * first line to the start of its last.
 *
 * A run starts and ends on code: labels, blank lines and comments at its edges
 * are left out, so a run only covers a label it carries on past. A run with no
 * code is dropped.
 */
function lineRuns(
  lines: AvailabilityLines,
  isCode: (line: number) => boolean,
): RegisterAvailabilityRange[] {
  const groups: AvailabilityLines[] = [];
  for (const item of lines) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (
      group &&
      last &&
      last.line === item.line - 1 &&
      last.availability === item.availability &&
      last.untilOverwritten === item.untilOverwritten
    ) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups.flatMap((group) => {
    const first = group.findIndex(({ line }) => isCode(line));
    if (first < 0) {
      return [];
    }
    let last = group.length - 1;
    while (!isCode(group[last].line)) {
      last--;
    }
    const { availability, untilOverwritten } = group[first];
    return [
      {
        range: lsp.Range.create(group[first].line, 0, group[last].line, 0),
        availability,
        ...(untilOverwritten ? { untilOverwritten: true } : {}),
      },
    ];
  });
}

/** What a routine does with the general-purpose registers. */
export interface RoutineRegisters {
  /** Registers it reads before writing them. */
  reads: string[];
  /** Code it runs could not be analysed, so it may read others. */
  mayReadOthers: boolean;
  /** Registers it may leave changed when it returns. */
  modifies: string[];
  /**
   * Registers it may also change through code that could not be analysed:
   * those not saved on the stack around that code.
   */
  mayModify: string[];
}

/**
 * The registers the routine starting at a non-local label reads and changes,
 * as its callers see them, following its flow and the subroutines it calls.
 * Registers it stashes on the stack and restores are not changed. The stack
 * pointer is left out: pushes and pops are taken to balance.
 */
export function routineRegisters(
  ctx: Context,
  uri: string,
  labelLine: number,
  calleeContract: (name: string) => RoutineContract | undefined,
): RoutineRegisters | undefined {
  const document = ctx.store.get(uri);
  if (!isProcessed(document)) {
    return;
  }
  const block = findBlockRange(ctx, {
    textDocument: { uri },
    position: lsp.Position.create(labelLine, 0),
  });
  if (!block || block.range.start.line !== labelLine) {
    return;
  }
  // A position before the block asks what is needed on entry to it.
  const analysis = registerLiveness(
    ctx,
    uri,
    document.parsed,
    document.blocks,
    document.document.getText().split(/\r?\n/g),
    block.range,
    lsp.Position.create(labelLine - 1, 0),
    new Set(),
    calleeContract,
  );
  const registers = [...generalPurposeRegisters].filter(
    (register) => register !== "a7",
  );
  const entry = registers.map(
    (register) =>
      [register, analysis.availability(register).availability] as const,
  );
  const modified = analysis.modifiedFrom(labelLine);
  return {
    reads: entry
      .filter(([, availability]) => availability === "unavailable")
      .map(([register]) => register),
    mayReadOthers: entry.some(([, availability]) => availability === "unknown"),
    modifies: registers.filter((register) => modified.registers.has(register)),
    mayModify: registers.filter(
      (register) =>
        modified.uncertain.has(register) && !modified.registers.has(register),
    ),
  };
}

function addReference(
  usages: Map<string, RegisterUsageReference[]>,
  register: string,
  reference: RegisterUsageReference,
) {
  (usages.get(register) ?? usages.set(register, []).get(register)!).push(
    reference,
  );
}

function addExpandedRegisters(
  line: ParsedLine,
  expanded: ExpandedLine,
  callRange: lsp.Range,
  usages: Map<string, RegisterUsageReference[]>,
  aliases: AliasResolver,
) {
  if (definesRegisters(line)) {
    return;
  }
  for (const node of walkLine(line)) {
    for (const found of registersAt(node, aliases)) {
      const { loc } = found.node;
      const reference: RegisterUsageReference = {
        range: sourceRangeForLocation(loc, expanded.spans) ?? callRange,
        spelling: expanded.text.slice(loc.start, loc.end),
        kind:
          found.kind === "explicit" && literalRegisterSpan(loc, expanded.spans)
            ? "explicit"
            : "macro-expansion",
        access: registerAccess(found.node, line),
      };
      for (const register of found.registers) {
        addReference(usages, register, reference);
      }
    }
  }
}

function summariseUsage(
  name: string,
  references: RegisterUsageReference[],
  savedOrRestored: (line: number) => boolean,
): RegisterUsage {
  // Saving a register to restore it later does not use its value.
  const firstAccess = references.find(
    ({ range }) => !savedOrRestored(range.start.line),
  )?.access;
  return {
    name,
    references,
    firstUse: references.reduce(
      (first, reference) =>
        comparePositions(reference.range.start, first) < 0
          ? reference.range.start
          : first,
      references[0].range.start,
    ),
    lastUse: references.reduce(
      (last, reference) =>
        comparePositions(reference.range.start, last) > 0
          ? reference.range.start
          : last,
      references[0].range.start,
    ),
    read: references.some(({ access }) => includesRead(access)),
    written: references.some(({ access }) => includesWrite(access)),
    input:
      firstAccess === undefined || firstAccess === "unknown"
        ? undefined
        : includesRead(firstAccess),
  };
}

function includesRead(access: RegisterAccess): boolean {
  return access === "read" || access === "readwrite";
}

function includesWrite(access: RegisterAccess): boolean {
  return access === "write" || access === "readwrite";
}

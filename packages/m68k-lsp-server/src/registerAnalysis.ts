import type {
  RegisterAccess,
  RegisterAvailability,
  RegisterAvailabilityRange,
  RegisterUsage,
  RegisterUsageReference,
  RegisterUsageParams,
  RegisterUsageResult,
  RegisterRangesResult,
  RoutineRangeParams,
  RoutineRangeResult,
} from "@m68k-lsp/protocol";
import * as lsp from "vscode-languageserver";
import {
  analyzeLocalLabelScopes,
  canonicalConditionMnemonic,
  enclosingBlocks,
  expandMacro,
  isLocalLabelName,
  macroInvocation,
  symbolKey,
} from "m68k-parser";
import type {
  Block,
  BlockStructure,
  ExpandedMacroLine,
  MacroExpansion,
  MacroDefinition,
  ParsedFile,
  ParsedLine,
} from "m68k-parser";
import { type AstNode, descendants, walkFile, walkLine } from "./ast";
import { type Context } from "./context";
import { symbolsCaseSensitive } from "./config";
import { isProcessed } from "./DocumentProcessor";
import { getUnitFilesByDistance } from "./files";
import { locationAsRange } from "m68k-parser";

const registerNodeTypes = new Set([
  "data-register",
  "address-register",
  "special-register",
  "fpu-data-register",
  "fpu-control-register",
]);

const generalPurposeRegisters = new Set([
  "d0",
  "d1",
  "d2",
  "d3",
  "d4",
  "d5",
  "d6",
  "d7",
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
]);

const readOnlyDestinations = new Set([
  "btst",
  "chk",
  "chk2",
  "cmp",
  "cmp2",
  "cmpa",
  "cmpi",
  "cmpm",
  "jmp",
  "jsr",
  "pea",
  "tst",
]);

const writeOnlyDestinations = new Set([
  "clr",
  "lea",
  "move",
  "movea",
  "moveq",
  "movep",
  "sf",
  "st",
  "scc",
  "scs",
  "seq",
  "sge",
  "sgt",
  "shi",
  "sle",
  "sls",
  "slt",
  "smi",
  "sne",
  "spl",
  "svc",
  "svs",
]);

const routineReturns = new Set(["rts", "rte", "rtr"]);
const conditionalBranches = new Set([
  "bcc",
  "bcs",
  "beq",
  "bge",
  "bgt",
  "bhi",
  "bhs",
  "ble",
  "blo",
  "bls",
  "blt",
  "bmi",
  "bne",
  "bpl",
  "bvc",
  "bvs",
]);

export function analyzeRegisterUsage(
  ctx: Context,
  params: RegisterUsageParams,
  options: {
    /** Registers the routine returns, whose values are needed at a return. */
    outputs?: ReadonlySet<string>;
  } = {},
): RegisterUsageResult | undefined {
  const document = ctx.store.get(params.textDocument.uri);
  if (!isProcessed(document)) {
    return;
  }

  const usages = new Map<string, RegisterUsageReference[]>();
  let incomplete = false;
  for (const { node, line } of walkFile(document.parsed)) {
    const range = locationAsRange(node.loc);
    if (!rangesOverlap(params.range, range)) {
      continue;
    }

    if (
      line.mnemonic?.type === "macro" &&
      findMacroDefinition(line.mnemonic.macro, params.textDocument.uri, ctx)
    ) {
      continue;
    }

    const register = canonicalGeneralPurposeRegister(registerName(node));
    if (register) {
      addReference(usages, register, {
        range,
        spelling: document.document.getText(range),
        kind: "explicit",
        access: registerAccess(node, line),
      });
      continue;
    }

    if (node.type === "register-list") {
      const registers = (node as AstNode & { registers?: unknown }).registers;
      if (!Array.isArray(registers)) {
        continue;
      }
      const reference: RegisterUsageReference = {
        range,
        spelling: document.document.getText(range),
        kind: "register-list",
        access: registerAccess(node, line),
      };
      for (const item of registers) {
        const listed = canonicalGeneralPurposeRegister(item);
        if (listed) {
          addReference(usages, listed, reference);
        }
      }
    }
  }

  const lineTexts = document.document.getText().split(/\r?\n/g);
  const macroDefinitionLines = collectMacroDefinitionLines(
    document.blocks.blocks,
  );
  for (const [index, line] of document.parsed.lines.entries()) {
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
      addExpandedRegisters(expanded.line, expanded, callRange, usages);
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
      )
    : undefined;
  return {
    documentVersion: document.document.version,
    ...(incomplete ? { incomplete: true } : {}),
    registers: Array.from(usages, ([name, references]) => {
      const usage = summariseUsage(name, references);
      if (liveness) {
        const { availability, untilOverwritten, lines } = liveness(name);
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

export function findRoutineRange(
  ctx: Context,
  params: RoutineRangeParams,
): RoutineRangeResult | undefined {
  const document = ctx.store.get(params.textDocument.uri);
  if (!isProcessed(document)) {
    return;
  }

  const lastLine = document.parsed.lines.length - 1;
  const cursorLine = Math.min(params.position.line, lastLine);
  const endOfFile = document.document.positionAt(
    document.document.getText().length,
  );

  // Within a macro definition the scope is its body, from MACRO to ENDM, as a
  // routine runs from its label to its return.
  const macro = enclosingBlocks(document.blocks, cursorLine)
    .filter((block) => block.kind === "macro")
    .at(-1);
  if (macro) {
    const endMnemonic =
      macro.end === undefined
        ? undefined
        : document.parsed.lines[macro.end]?.mnemonic;
    return {
      range: lsp.Range.create(
        lsp.Position.create(macro.start, 0),
        endMnemonic
          ? lsp.Position.create(macro.end!, endMnemonic.loc.end)
          : endOfFile,
      ),
      label: macro.name ?? "Macro",
    };
  }

  // Outside one, a macro body's labels and returns belong to the macro and
  // neither start nor end the routine.
  const macroDefinitionLines = collectMacroDefinitionLines(
    document.blocks.blocks,
  );

  let startLine: number | undefined;
  for (let index = cursorLine; index >= 0; index--) {
    const line = document.parsed.lines[index];
    if (!macroDefinitionLines.has(index) && isNonLocalCodeLabel(line)) {
      startLine = index;
      break;
    }
  }
  startLine ??= 0;
  const start = document.parsed.lines[startLine];
  const label = isNonLocalCodeLabel(start) ? start.label : undefined;

  const flowEnd = routineFlowEnd(
    document.parsed,
    startLine,
    macroDefinitionLines,
    symbolsCaseSensitive(ctx.config),
  );
  if (flowEnd === "end-of-file") {
    return {
      range: lsp.Range.create(lsp.Position.create(startLine, 0), endOfFile),
      label: label?.label ?? "Start of file",
    };
  }
  const caseSensitive = symbolsCaseSensitive(ctx.config);
  const scopeTo = (end: number) => ({
    range: lsp.Range.create(
      lsp.Position.create(startLine, 0),
      lsp.Position.create(end, lineContentEnd(document.parsed.lines[end])),
    ),
    label: label?.label ?? "Start of file",
  });
  if (flowEnd >= cursorLine) {
    return scopeTo(flowEnd);
  }

  // Past the routine's flow, code it never reaches, such as a fragment
  // entered from elsewhere, still belongs to the routine, up to where that
  // code's own flow ends. Blank lines, comments and data between routines
  // belong to none.
  for (let index = cursorLine; index > flowEnd; index--) {
    const mnemonic = document.parsed.lines[index].mnemonic?.type;
    if (
      macroDefinitionLines.has(index) ||
      (mnemonic !== "instruction" && mnemonic !== "macro")
    ) {
      continue;
    }
    const fragmentEnd = routineFlowEnd(
      document.parsed,
      index,
      macroDefinitionLines,
      caseSensitive,
    );
    if (fragmentEnd === "end-of-file") {
      return {
        range: lsp.Range.create(lsp.Position.create(startLine, 0), endOfFile),
        label: label?.label ?? "Start of file",
      };
    }
    return fragmentEnd >= cursorLine ? scopeTo(fragmentEnd) : undefined;
  }
  return undefined;
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
 * Last line a routine's own control flow reaches from its first line.
 *
 * Flow falls through to the next line, including into later non-local labels,
 * and follows branches to local labels, so code after a conditional early
 * return stays in the routine. Unconditional returns, BRA and JMP end a path;
 * one to a non-local label is a tail call out of the routine and is not
 * followed. A jump whose target cannot be resolved, such as `jmp (a0)`, is
 * assumed to continue into the code after it. Macro definitions are passed
 * over.
 *
 * An indexed jump such as `jmp .table(pc,d0.w)` can land on any entry of the
 * table at its target, so each consecutive `bra`/`jmp` or `dc` entry there is
 * reached, and the local labels the entries name are followed.
 */
function routineFlowEnd(
  file: ParsedFile,
  startLine: number,
  skippedLines: Set<number>,
  caseSensitive: boolean,
): number | "end-of-file" {
  const { lines } = file;
  const labels = collectControlFlowLabels(file, caseSensitive);
  const localTarget = (name: string | undefined, from: number) => {
    const target = name === undefined ? undefined : labels.resolve(name, from);
    return target !== undefined && lines[target]?.label?.scope === "local"
      ? target
      : undefined;
  };
  const reached = new Set<number>();
  const reachedTables = new Set<number>();
  const pending: { index: number; table: boolean }[] = [
    { index: startLine, table: false },
  ];
  let last = startLine;
  while (pending.length) {
    const { index, table } = pending.pop()!;
    if (index >= lines.length) {
      return "end-of-file";
    }
    const line = lines[index];
    const mnemonic =
      !skippedLines.has(index) && line.mnemonic?.type === "instruction"
        ? canonicalConditionMnemonic(line.mnemonic.instruction).toLowerCase()
        : undefined;

    if (table) {
      const entry =
        mnemonic === "bra" ||
        mnemonic === "jmp" ||
        (line.mnemonic?.type === "directive" &&
          line.mnemonic.directive.toLowerCase() === "dc");
      if (entry || !line.mnemonic) {
        if (!reachedTables.has(index)) {
          reachedTables.add(index);
          last = Math.max(last, index);
          for (const node of walkLine(line)) {
            const target = localTarget(
              node.type === "symbol"
                ? (node as AstNode & { name: string }).name
                : undefined,
              index,
            );
            if (target !== undefined) {
              pending.push({ index: target, table: false });
            }
          }
          pending.push({ index: index + 1, table: true });
        }
        continue;
      }
    }

    if (reached.has(index)) {
      continue;
    }
    reached.add(index);
    last = Math.max(last, index);
    // A conditional statement (`iif`) may not run, so it never ends the flow.
    const conditional = line.inlineCondition !== undefined;
    if (mnemonic && !conditional && routineReturns.has(mnemonic)) {
      continue;
    }
    if (mnemonic && isBranchMnemonic(mnemonic)) {
      const target = branchTarget(line);
      const targetLine = localTarget(target, index);
      if (targetLine !== undefined) {
        const operand = line.operands?.at(-1)?.type;
        pending.push({
          index: targetLine,
          table:
            mnemonic === "jmp" &&
            (operand === "pc-relative-index" ||
              operand === "address-register-indirect-index"),
        });
      }
      const unconditional =
        !conditional && (mnemonic === "bra" || mnemonic === "jmp");
      // A named target outside the local labels leaves the routine. Without
      // a name the jump is indirect.
      if (unconditional && target !== undefined) {
        continue;
      }
    }
    pending.push({ index: index + 1, table: false });
  }
  return last;
}

/** Column after a line's last statement node, before any comment. */
function lineContentEnd(line: ParsedLine): number {
  return (
    line.operands?.at(-1)?.loc.end ??
    line.mnemonic?.loc.end ??
    line.label?.loc.end ??
    0
  );
}

export function isNonLocalCodeLabel(line: ParsedLine): boolean {
  return (
    line.label !== undefined &&
    line.label.scope !== "local" &&
    line.mnemonic?.type !== "directive"
  );
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

/**
 * What one step of execution does to a register: how many low-order bits of
 * its current value it reads, and how many it replaces (8, 16 or 32; 0 for
 * none). The read happens before the write.
 */
interface RegisterEffect {
  read: number;
  write: number;
}

/**
 * The register effects of a line, in execution order: one step for an
 * instruction, one per expanded line for a macro call. `unknown` stands for
 * code that could not be expanded, which may do anything.
 */
type LineSteps = (Map<string, RegisterEffect> | "unknown")[];

/**
 * Lines in the scope that leave a register alone while its value is not
 * needed, or might not be, in order. `untilOverwritten` marks free lines where
 * it stays free only until a later write replaces it.
 */
type AvailabilityLines = {
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
 * return.
 * A same-file subroutine counts as reading every register it touches; one
 * that cannot be resolved makes the answer unknown. A branch whose target
 * cannot be resolved makes every register unavailable. A return reads the
 * routine's outputs.
 */
function registerLiveness(
  ctx: Context,
  uri: string,
  file: ParsedFile,
  blocks: BlockStructure,
  lineTexts: string[],
  scope: lsp.Range,
  position: lsp.Position,
  outputs: ReadonlySet<string>,
): (register: string) => RegisterLiveness {
  const { lines } = file;
  const labels = collectControlFlowLabels(
    file,
    symbolsCaseSensitive(ctx.config),
  );
  const macroDefinitionLines = collectMacroDefinitionLines(blocks.blocks);

  const stepsCache = new Map<number, LineSteps>();
  const stepsFor = (index: number): LineSteps => {
    let steps = stepsCache.get(index);
    if (!steps) {
      steps = lineSteps(
        ctx,
        uri,
        lines[index],
        lineTexts[index] ?? "",
        macroDefinitionLines.has(index),
        enclosingBlocks(blocks, index).some(
          (block) => block.kind === "conditional",
        ),
      );
      stepsCache.set(index, steps);
    }
    return steps;
  };

  /** Where flow can go after a line, or `escape` for an unresolved branch. */
  const successors = (
    index: number,
  ): { next: number[]; call?: number | "unresolved" } | "escape" => {
    const line = lines[index];
    const mnemonic =
      !macroDefinitionLines.has(index) && line.mnemonic?.type === "instruction"
        ? line.mnemonic.instruction.toLowerCase()
        : undefined;
    // A conditional statement (`iif`) may not run, so it never ends the flow.
    const conditional = line.inlineCondition !== undefined;
    let call: number | "unresolved" | undefined;
    if (mnemonic === "bsr" || mnemonic === "jsr") {
      const target = controlFlowTarget(line);
      call =
        (target === undefined ? undefined : labels.resolve(target, index)) ??
        "unresolved";
    }
    if (!conditional && mnemonic && routineReturns.has(mnemonic)) {
      return { next: [], call };
    }
    const next: number[] = [];
    if (mnemonic && isBranchMnemonic(mnemonic)) {
      const target = branchTarget(line);
      const targetLine =
        target === undefined ? undefined : labels.resolve(target, index);
      if (targetLine === undefined) {
        return "escape";
      }
      next.push(targetLine);
      if (!conditional && (mnemonic === "bra" || mnemonic === "jmp")) {
        return { next, call };
      }
    }
    next.push(index + 1);
    return { next, call };
  };

  // Registers a subroutine may touch, following its own flow and calls.
  const calleeCache = new Map<number, Set<string> | "unknown" | "all">();
  const calleeRegisters = (start: number): Set<string> | "unknown" | "all" => {
    const cached = calleeCache.get(start);
    if (cached) {
      return cached;
    }
    const touched = new Set<string>();
    let unknown = false;
    const visited = new Set<number>();
    const pending = [start];
    // Recursion sees the registers found so far, which is the fixed point.
    calleeCache.set(start, touched);
    while (pending.length) {
      const index = pending.pop()!;
      if (index >= lines.length || visited.has(index)) {
        continue;
      }
      visited.add(index);
      for (const step of stepsFor(index)) {
        if (step === "unknown") {
          unknown = true;
        } else {
          for (const register of step.keys()) {
            touched.add(register);
          }
        }
      }
      const flow = successors(index);
      if (flow === "escape") {
        calleeCache.set(start, "all");
        return "all";
      }
      if (flow.call === "unresolved") {
        unknown = true;
      } else if (flow.call !== undefined) {
        const nested = calleeRegisters(flow.call);
        if (nested === "all") {
          calleeCache.set(start, "all");
          return "all";
        }
        if (nested === "unknown") {
          unknown = true;
        } else {
          for (const register of nested) {
            touched.add(register);
          }
        }
      }
      pending.push(...flow.next);
    }
    const result = unknown ? "unknown" : touched;
    calleeCache.set(start, result);
    return result;
  };

  const endLine = Math.min(scope.end.line, lines.length - 1);

  // The flow graph: every line in the scope and everything reachable from it.
  interface FlowNode {
    next: number[];
    /** Flow can leave here: a return, or running off the end of the file. */
    exit: boolean;
    /** A branch whose target cannot be resolved; it may go anywhere. */
    escape: boolean;
    call?: number | "unresolved";
  }
  const nodes = new Map<number, FlowNode>();
  const pending: number[] = [];
  for (let index = scope.start.line; index <= endLine; index++) {
    pending.push(index);
  }
  while (pending.length) {
    const index = pending.pop()!;
    if (index >= lines.length || nodes.has(index)) {
      continue;
    }
    const flow = successors(index);
    if (flow === "escape") {
      nodes.set(index, { next: [], exit: false, escape: true });
      continue;
    }
    const next = flow.next.filter((line) => line < lines.length);
    nodes.set(index, {
      next,
      exit: next.length < flow.next.length || !flow.next.length,
      escape: false,
      call: flow.call,
    });
    pending.push(...next);
  }
  const order = [...nodes.keys()].sort((a, b) => b - a);

  return (register) => {
    // How much the register's value is needed: not at all, possibly (code
    // that could not be analysed), or certainly.
    // How much of the register's value is needed: the number of low-order
    // bits later code reads, and whether code that could not be analysed
    // might read it.
    interface Need {
      bits: number;
      unknown: boolean;
    }
    const NONE: Need = { bits: 0, unknown: false };
    const join = (a: Need, b: Need): Need => ({
      bits: Math.max(a.bits, b.bits),
      unknown: a.unknown || b.unknown,
    });
    const same = (a: Need, b: Need) =>
      a.bits === b.bits && a.unknown === b.unknown;
    const exitNeed: Need = outputs.has(register)
      ? { bits: 32, unknown: false }
      : NONE;

    const callNeed = (node: FlowNode): Need | undefined => {
      if (node.call === undefined) {
        return undefined;
      }
      if (node.call === "unresolved") {
        return { bits: 0, unknown: true };
      }
      const callee = calleeRegisters(node.call);
      return callee === "all" || (callee !== "unknown" && callee.has(register))
        ? { bits: 32, unknown: false }
        : callee === "unknown"
          ? { bits: 0, unknown: true }
          : undefined;
    };
    /** Need on entry to a line, given the need after it. */
    const transfer = (index: number, node: FlowNode, after: Need): Need => {
      if (node.escape) {
        return { bits: 32, unknown: false };
      }
      // The call runs after the line's operands are evaluated.
      let need = join(after, callNeed(node) ?? NONE);
      const steps = stepsFor(index);
      for (let step = steps.length - 1; step >= 0; step--) {
        const effects = steps[step];
        if (effects === "unknown") {
          need = { ...need, unknown: true };
          continue;
        }
        const effect = effects.get(register);
        if (!effect) {
          continue;
        }
        // A write leaves the earlier value unneeded once it replaces every bit
        // still to be read; otherwise the bits it keeps carry the old value.
        if (effect.write && need.bits <= effect.write) {
          need = NONE;
        }
        if (effect.read) {
          need = { ...need, bits: Math.max(need.bits, effect.read) };
        }
      }
      return need;
    };
    /** Whether a line does anything to the register, or might. */
    const touches = (index: number, node: FlowNode): boolean =>
      node.escape ||
      callNeed(node) !== undefined ||
      stepsFor(index).some((step) => step === "unknown" || step.has(register));

    const needIn = new Map<number, Need>();
    const touchedIn = new Map<number, boolean>();
    const needOut = (node: FlowNode): Need =>
      node.next.reduce(
        (need, next) => join(need, needIn.get(next) ?? NONE),
        node.exit ? exitNeed : NONE,
      );
    const touchedOut = (node: FlowNode): boolean =>
      node.next.some((next) => touchedIn.get(next));
    for (let changed = true; changed;) {
      changed = false;
      for (const index of order) {
        const node = nodes.get(index)!;
        const need = transfer(index, node, needOut(node));
        const touched = touches(index, node) || touchedOut(node);
        if (
          !same(need, needIn.get(index) ?? NONE) ||
          touched !== (touchedIn.get(index) ?? false)
        ) {
          needIn.set(index, need);
          touchedIn.set(index, touched);
          changed = true;
        }
      }
    }
    const status = (need: Need) =>
      need.bits ? "unavailable" : need.unknown ? "unknown" : "available";

    // Lines that leave the register alone while its value is not needed, or
    // where that depends on code that could not be analysed.
    const free: AvailabilityLines = [];
    for (let index = scope.start.line; index <= endLine; index++) {
      const node = nodes.get(index);
      const need = status(needIn.get(index) ?? NONE);
      if (node && need !== "unavailable" && !touches(index, node)) {
        free.push({
          line: index,
          availability: need,
          untilOverwritten: need === "available" && touchedOut(node),
        });
      }
    }

    // At the cursor, what matters is what happens after its line runs.
    let need: Need;
    let touched: boolean;
    const origin = nodes.get(position.line);
    if (position.line > endLine) {
      need = NONE;
      touched = false;
    } else if (position.line < scope.start.line || !origin) {
      need = needIn.get(scope.start.line) ?? NONE;
      touched = touchedIn.get(scope.start.line) ?? false;
    } else {
      need = needOut(origin);
      touched = touchedOut(origin);
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
}

/** Register effects of a line, in execution order (see `LineSteps`). */
function lineSteps(
  ctx: Context,
  uri: string,
  line: ParsedLine,
  lineText: string,
  inMacroDefinition: boolean,
  inConditional: boolean,
): LineSteps {
  // A macro body runs where the macro is called, not where it is defined.
  if (inMacroDefinition) {
    return [];
  }
  if (line.mnemonic?.type === "macro") {
    const expansion = expandMacroCall(ctx, uri, line, lineText);
    if (expansion) {
      const steps: LineSteps = [];
      let conditionalDepth = 0;
      for (const expanded of expansion.lines) {
        const directive =
          expanded.line.mnemonic?.type === "directive"
            ? expanded.line.mnemonic.directive.toLowerCase()
            : undefined;
        if (directive && directive !== "iif" && directive.startsWith("if")) {
          conditionalDepth++;
        } else if (directive === "endc" || directive === "endif") {
          conditionalDepth = Math.max(0, conditionalDepth - 1);
        }
        if (!expanded.expandedCall) {
          steps.push(
            lineEffects(expanded.line, inConditional || conditionalDepth > 0),
          );
        }
      }
      if (expansion.incomplete) {
        steps.push("unknown");
      }
      return steps;
    }
  }
  return [lineEffects(line, inConditional)];
}

/**
 * What a single line does to each register it names: the bits it reads and
 * replaces (see `RegisterEffect`). A write that may not happen, under `iif`
 * or in an `if` block, replaces nothing.
 */
function lineEffects(
  line: ParsedLine,
  inConditional: boolean,
): Map<string, RegisterEffect> {
  const effects = new Map<string, RegisterEffect>();
  const conditional = inConditional || line.inlineCondition !== undefined;
  const operands = (line.operands ?? []) as AstNode[];
  for (const [operandIndex, operand] of operands.entries()) {
    for (const node of [operand, ...descendants(operand)]) {
      const single = canonicalGeneralPurposeRegister(registerName(node));
      const listed =
        node.type === "register-list"
          ? ((node as AstNode & { registers?: unknown }).registers as unknown[])
          : undefined;
      const registers = single
        ? [single]
        : Array.isArray(listed)
          ? listed.flatMap(
              (item) => canonicalGeneralPurposeRegister(item) ?? [],
            )
          : [];
      if (!registers.length) {
        continue;
      }
      const access = registerAccess(node, line);
      for (const register of registers) {
        const bits = accessBits(
          line,
          operand,
          node,
          operandIndex === operands.length - 1,
          register,
        );
        const read = access === "write" ? 0 : bits.read;
        const write =
          (access === "write" || access === "readwrite") && !conditional
            ? bits.write
            : 0;
        const previous = effects.get(register);
        effects.set(register, {
          read: Math.max(previous?.read ?? 0, read),
          // Two writes on one line are not expected; keep the narrower.
          write:
            previous?.write && write
              ? Math.min(previous.write, write)
              : (previous?.write ?? 0) || write,
        });
      }
    }
  }
  return effects;
}

const qualifierBits: Partial<Record<string, number>> = {
  b: 8,
  w: 16,
  l: 32,
  s: 32,
};

/** Instructions that operate on a whole data register whatever their size. */
const longRegisterInstructions = new Set([
  "bchg",
  "bclr",
  "bset",
  "btst",
  "exg",
  "lea",
  "moveq",
  "swap",
]);

/** Instructions that only ever write a byte. */
const byteWriteInstructions = new Set(["abcd", "nbcd", "sbcd", "tas"]);

/**
 * How many low-order bits of a register an operand reads and replaces.
 *
 * Address registers are always used and written whole: word writes to them
 * are sign-extended. A register inside an addressing mode is an address, read
 * whole, or an index, read at its index size (a word by default). A data
 * register operand is read and written at the operation size, which is a word
 * when the source gives none, with these exceptions: MOVEM loads and the
 * destination of a word MULU/MULS are sign- or zero-extended to the whole
 * register, a word DIVU/DIVS reads the whole dividend, DBcc counts in a word,
 * Scc and the BCD instructions write a byte, and some instructions always
 * work on all 32 bits. A size the register cannot have reads it whole and
 * replaces nothing.
 */
function accessBits(
  line: ParsedLine,
  operand: AstNode,
  node: AstNode,
  destination: boolean,
  register: string,
): RegisterEffect {
  if (register.startsWith("a")) {
    return { read: 32, write: 32 };
  }
  if (node !== operand) {
    const index = [operand, ...descendants(operand)].find(
      (item) =>
        (item as AstNode & { indexRegister?: unknown }).indexRegister === node,
    ) as (AstNode & { indexSize?: AstNode & { size?: string } }) | undefined;
    if (index) {
      return {
        read: index.indexSize?.size?.toLowerCase() === "l" ? 32 : 16,
        write: 0,
      };
    }
    return { read: 32, write: 0 };
  }

  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? canonicalConditionMnemonic(line.mnemonic.instruction).toLowerCase()
      : undefined;
  if (!mnemonic) {
    return { read: 32, write: 0 };
  }
  const qualifier =
    line.qualifier?.type === "size"
      ? line.qualifier.size.toLowerCase()
      : undefined;
  const size = qualifier === undefined ? 16 : qualifierBits[qualifier];
  if (size === undefined) {
    return { read: 32, write: 0 };
  }
  if (longRegisterInstructions.has(mnemonic) || mnemonic.startsWith("bf")) {
    return { read: 32, write: 32 };
  }
  if (mnemonic === "movem") {
    return { read: size, write: 32 };
  }
  if (mnemonic.startsWith("db")) {
    return { read: 16, write: 16 };
  }
  if (destination && size === 16) {
    if (mnemonic === "divu" || mnemonic === "divs") {
      return { read: 32, write: 32 };
    }
    if (mnemonic === "mulu" || mnemonic === "muls") {
      return { read: 16, write: 32 };
    }
  }
  if (byteWriteInstructions.has(mnemonic) || /^s(?!ub|wap)/.test(mnemonic)) {
    return { read: size, write: 8 };
  }
  return { read: size, write: size };
}

function expandMacroCall(
  ctx: Context,
  uri: string,
  line: ParsedLine,
  lineText: string,
): MacroExpansion<lsp.Range> | undefined {
  if (line.mnemonic?.type !== "macro") {
    return;
  }
  const definition = findMacroDefinition(line.mnemonic.macro, uri, ctx);
  if (!definition) {
    return;
  }
  return expandMacro(
    definition,
    macroInvocation<lsp.Range>(line, lineText, (text, loc) => ({
      origin: locationAsRange(loc),
      literal: !!canonicalGeneralPurposeRegister(text),
    })),
    {
      resolve: (name) => findMacroDefinition(name, uri, ctx),
      fallbackOrigin: locationAsRange(line.mnemonic.loc),
    },
  );
}

interface ControlFlowLabels {
  /** The line a label name refers to, as seen from the line that names it. */
  resolve(name: string, fromLine: number): number | undefined;
}

/**
 * Where each label the flow can reach is defined.
 *
 * A local label is found through the scope of the line that names it, which is
 * worked out once for every tool by the parser; a global one by its name.
 */
function collectControlFlowLabels(
  file: ParsedFile,
  caseSensitive: boolean,
): ControlFlowLabels {
  const scopes = analyzeLocalLabelScopes(file, { caseSensitive });
  const labels = new Map<string, number>();
  file.lines.forEach((line, index) => {
    const label = line.label;
    if (!label) return;
    if (label.scope === "local") {
      labels.set(scopes.keyOf(index, label.label), index);
    } else if (isNonLocalCodeLabel(line)) {
      labels.set(symbolKey(label.label, caseSensitive), index);
    }
  });
  return {
    resolve: (name, fromLine) =>
      labels.get(
        isLocalLabelName(name)
          ? scopes.keyOf(fromLine, name)
          : symbolKey(name, caseSensitive),
      ),
  };
}

function branchTarget(line: ParsedLine): string | undefined {
  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? line.mnemonic.instruction.toLowerCase()
      : undefined;
  if (!mnemonic || !isBranchMnemonic(mnemonic)) {
    return;
  }
  return controlFlowTarget(line);
}

function controlFlowTarget(line: ParsedLine): string | undefined {
  const operand = line.operands?.at(-1);
  if (!operand) {
    return;
  }
  const nodes = [operand as AstNode, ...descendants(operand as AstNode)];
  const symbol = nodes.find((node) => node.type === "symbol") as
    (AstNode & { name?: unknown }) | undefined;
  return typeof symbol?.name === "string" ? symbol.name : undefined;
}

function isBranchMnemonic(mnemonic: string): boolean {
  return (
    mnemonic === "bra" ||
    mnemonic === "jmp" ||
    conditionalBranches.has(mnemonic) ||
    mnemonic.startsWith("db") ||
    mnemonic.startsWith("fb") ||
    mnemonic.startsWith("cpb") ||
    mnemonic.startsWith("cpdb")
  );
}

export function registerName(node: AstNode) {
  const register = (node as AstNode & { register?: unknown }).register;
  if (!registerNodeTypes.has(node.type) || typeof register !== "string") {
    return;
  }
  return register.toLowerCase();
}

export function canonicalGeneralPurposeRegister(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const register = value.toLowerCase() === "sp" ? "a7" : value.toLowerCase();
  return generalPurposeRegisters.has(register) ? register : undefined;
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

type ExpandedLine = ExpandedMacroLine<lsp.Range>;

function collectMacroDefinitionLines(blocks: Block[]): Set<number> {
  const lines = new Set<number>();
  const visit = (items: Block[]) => {
    for (const block of items) {
      if (block.kind === "macro" && block.end !== undefined) {
        for (let index = block.start; index <= block.end; index++) {
          lines.add(index);
        }
      }
      visit(block.children);
    }
  };
  visit(blocks);
  return lines;
}

function findMacroDefinition(
  name: string,
  documentUri: string,
  ctx: Context,
): MacroDefinition | undefined {
  const key = symbolKey(name, symbolsCaseSensitive(ctx.config));
  for (const uri of [
    documentUri,
    ...getUnitFilesByDistance(documentUri, ctx),
  ]) {
    const definition = ctx.store.get(uri)?.macros.get(key);
    if (definition) {
      return definition;
    }
  }
}

function addExpandedRegisters(
  line: ParsedLine,
  expanded: ExpandedLine,
  callRange: lsp.Range,
  usages: Map<string, RegisterUsageReference[]>,
) {
  for (const node of walkLine(line)) {
    const register = canonicalGeneralPurposeRegister(registerName(node));
    if (register) {
      addReference(usages, register, {
        range: sourceRangeForLocation(node.loc, expanded.spans) ?? callRange,
        spelling: expanded.text.slice(node.loc.start, node.loc.end),
        kind: literalRegisterSpan(node.loc, expanded.spans)
          ? "explicit"
          : "macro-expansion",
        access: registerAccess(node, line),
      });
      continue;
    }
    if (node.type !== "register-list") {
      continue;
    }
    const registers = (node as AstNode & { registers?: unknown }).registers;
    if (!Array.isArray(registers)) {
      continue;
    }
    const reference: RegisterUsageReference = {
      range: sourceRangeForLocation(node.loc, expanded.spans) ?? callRange,
      spelling: expanded.text.slice(node.loc.start, node.loc.end),
      kind: "macro-expansion",
      access: registerAccess(node, line),
    };
    for (const item of registers) {
      const listed = canonicalGeneralPurposeRegister(item);
      if (listed) {
        addReference(usages, listed, reference);
      }
    }
  }
}

// Only a whole, unchanged register argument can safely be edited at its source.
// Overlapping spans still provide useful navigation for constructed registers.
function literalRegisterSpan(
  location: AstNode["loc"],
  spans: ExpandedLine["spans"],
): ExpandedLine["spans"][number] | undefined {
  return spans.find(
    (span) =>
      span.literal &&
      span.start === location.start &&
      span.end === location.end,
  );
}

function sourceRangeForLocation(
  location: AstNode["loc"],
  spans: ExpandedLine["spans"],
): lsp.Range | undefined {
  return spans.find(
    (span) => location.start < span.end && span.start < location.end,
  )?.origin;
}

function summariseUsage(
  name: string,
  references: RegisterUsageReference[],
): RegisterUsage {
  const firstAccess = references[0]?.access;
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

function registerAccess(node: AstNode, line: ParsedLine): RegisterAccess {
  // The synonym spellings (SHS, SLO, DBRA) are the instructions they stand for.
  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? canonicalConditionMnemonic(line.mnemonic.instruction)
      : undefined;
  const operands = line.operands ?? [];
  const operandIndex = operands.findIndex((operand) =>
    containsLocation(operand.loc, node.loc),
  );
  if (!mnemonic || operandIndex < 0) {
    return "unknown";
  }

  const operand = operands[operandIndex] as AstNode;
  if (operand !== node) {
    return operand.type === "address-register-indirect-postinc" ||
      operand.type === "address-register-indirect-predec"
      ? "readwrite"
      : "read";
  }

  if (mnemonic === "movem" && node.type === "register-list") {
    return operandIndex === 0 ? "read" : "write";
  }
  if (mnemonic === "exg" || mnemonic === "link" || mnemonic.startsWith("db")) {
    return "readwrite";
  }
  if (operandIndex < operands.length - 1) {
    return "read";
  }
  if (readOnlyDestinations.has(mnemonic)) {
    return "read";
  }
  if (writeOnlyDestinations.has(mnemonic)) {
    return "write";
  }
  return "readwrite";
}

function containsLocation(
  container: AstNode["loc"],
  item: AstNode["loc"],
): boolean {
  return container.start <= item.start && item.end <= container.end;
}

function includesRead(access: RegisterAccess): boolean {
  return access === "read" || access === "readwrite";
}

function includesWrite(access: RegisterAccess): boolean {
  return access === "write" || access === "readwrite";
}

function rangesOverlap(left: lsp.Range, right: lsp.Range): boolean {
  return (
    comparePositions(left.start, right.end) < 0 &&
    comparePositions(right.start, left.end) < 0
  );
}

function comparePositions(left: lsp.Position, right: lsp.Position): number {
  return left.line - right.line || left.character - right.character;
}

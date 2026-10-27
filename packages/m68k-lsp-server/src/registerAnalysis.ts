import type {
  RegisterAccess,
  RegisterAvailability,
  RegisterAvailabilityRange,
  RegisterUsage,
  RegisterUsageReference,
  RegisterUsageParams,
  RegisterUsageResult,
  RegisterRangesResult,
  BlockRangeParams,
  BlockRangeResult,
} from "@m68k-lsp/protocol";
import * as lsp from "vscode-languageserver";
import {
  analyzeLocalLabelScopes,
  canonicalConditionMnemonic,
  enclosingBlocks,
  expandMacro,
  isLocalLabelName,
  macroInvocation,
  parseLine,
  parseRegisterList,
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
import { DefinitionType, resolveDefinitionByName } from "./symbols";
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

export function findBlockRange(
  ctx: Context,
  params: BlockRangeParams,
): BlockRangeResult | undefined {
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
  // block runs from its label to the end of its flow.
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
  // neither start nor end the block.
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

  const flowEnd = blockFlowEnd(
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

  // Past the block's flow, code it never reaches, such as a fragment
  // entered from elsewhere, still belongs to the block, up to where that
  // code's own flow ends. A label leads into the code after it. Blank lines,
  // comments and data between blocks belong to none.
  const lines = document.parsed.lines;
  const isCode = (index: number) => {
    const type = lines[index].mnemonic?.type;
    return (
      !macroDefinitionLines.has(index) &&
      (type === "instruction" || type === "macro")
    );
  };
  let codeLine: number | undefined;
  if (lines[cursorLine].label && !isCode(cursorLine)) {
    for (let index = cursorLine + 1; index < lines.length; index++) {
      if (isCode(index)) {
        codeLine = index;
        break;
      }
      if (lines[index].mnemonic || isNonLocalCodeLabel(lines[index])) {
        break;
      }
    }
  }
  for (
    let index = cursorLine;
    codeLine === undefined && index > flowEnd;
    index--
  ) {
    if (isCode(index)) {
      codeLine = index;
    }
  }
  if (codeLine !== undefined) {
    const fragmentEnd = blockFlowEnd(
      document.parsed,
      codeLine,
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
 * Last line a block's own control flow reaches from its first line.
 *
 * Flow falls through to the next line, including into later non-local labels,
 * and follows branches to local labels, so code after a conditional early
 * return stays in the block. Unconditional returns, BRA and JMP end a path;
 * one to a non-local label is a tail call out of the block and is not
 * followed. A jump whose target cannot be resolved, such as `jmp (a0)`, is
 * assumed to continue into the code after it. Macro definitions are passed
 * over.
 *
 * An indexed jump such as `jmp .table(pc,d0.w)` can land on any entry of the
 * table at its target, so each consecutive `bra`/`jmp` or `dc` entry there is
 * reached, and the local labels the entries name are followed.
 */
function blockFlowEnd(
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
      // A named target outside the local labels leaves the block. Without
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
  /** The line may change the register, even where `write` is 0. */
  modifies?: boolean;
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

/** A subroutine call: its first line in this file, or the name it is called by. */
export interface FlowCall {
  line?: number;
  name?: string;
}

/** Where flow can go after a line. */
export interface FlowNode {
  next: number[];
  /** Flow can leave here: a return, or running off the end of the file. */
  exit: boolean;
  /** A branch whose target cannot be resolved; it may go anywhere. */
  escape: boolean;
  call?: FlowCall;
}

/**
 * The control flow of a file, line by line: each line's successors, built on
 * demand. Flow falls through, follows branches to labels in the file, and
 * ends at returns; a conditional (`iif`) statement never ends it. Lines in
 * macro definitions are passed over. A call continues after itself, with the
 * subroutine it calls noted on the line rather than followed.
 */
export function createFlowGraph(
  file: ParsedFile,
  blocks: BlockStructure,
  ctx: Context,
  uri: string,
  lineTexts: string[],
): (index: number) => FlowNode {
  const { lines } = file;
  const caseSensitive = symbolsCaseSensitive(ctx.config);
  const labels = collectControlFlowLabels(file, caseSensitive);
  const macroDefinitionLines = collectMacroDefinitionLines(blocks.blocks);
  const nodes = new Map<number, FlowNode>();
  return (index: number): FlowNode => {
    const cached = nodes.get(index);
    if (cached) {
      return cached;
    }
    const line = lines[index];
    const mnemonic =
      !macroDefinitionLines.has(index) && line.mnemonic?.type === "instruction"
        ? line.mnemonic.instruction.toLowerCase()
        : undefined;
    // A conditional statement (`iif`) may not run, so it never ends the flow.
    const conditional = line.inlineCondition !== undefined;
    let call: FlowCall | undefined;
    if (mnemonic === "bsr" || mnemonic === "jsr") {
      const name = controlFlowTarget(line);
      call = {
        name,
        line: name === undefined ? undefined : labels.resolve(name, index),
      };
    }
    const node = ((): FlowNode => {
      if (!conditional && mnemonic && routineReturns.has(mnemonic)) {
        return { next: [], exit: true, escape: false, call };
      }
      const next: number[] = [];
      if (mnemonic && isBranchMnemonic(mnemonic)) {
        const target = branchTarget(line);
        const targetLine =
          target === undefined ? undefined : labels.resolve(target, index);
        if (targetLine === undefined) {
          return { next: [], exit: false, escape: true };
        }
        next.push(targetLine);
        if (!conditional && (mnemonic === "bra" || mnemonic === "jmp")) {
          return { next, exit: false, escape: false, call };
        }
      }
      next.push(index + 1);
      const inFile = next.filter((target) => target < lines.length);
      return {
        next: inFile,
        exit: inFile.length < next.length,
        escape: false,
        call,
      };
    })();
    nodes.set(index, withMacroFlow(index, node));
    return nodes.get(index)!;
  };

  // A macro call goes wherever its expansion's branches lead out of it, and
  // may return if the expansion does.
  function withMacroFlow(index: number, node: FlowNode): FlowNode {
    const line = lines[index];
    if (line.mnemonic?.type !== "macro" || macroDefinitionLines.has(index)) {
      return node;
    }
    const expansion = expandMacroCall(ctx, uri, line, lineTexts[index] ?? "");
    const flow = expansion && expansionFlow(expansion, caseSensitive);
    if (!flow?.hasFlow) {
      return node;
    }
    if (flow.indirect) {
      return { next: [], exit: false, escape: true };
    }
    const next = [...node.next];
    for (const target of flow.targets) {
      const targetLine = labels.resolve(target, index);
      if (targetLine === undefined) {
        return { next: [], exit: false, escape: true };
      }
      if (!next.includes(targetLine)) {
        next.push(targetLine);
      }
    }
    return { ...node, next, exit: node.exit || flow.returns };
  }
}

/**
 * The control flow inside a macro expansion: whether it has any (labels,
 * branches or returns of its own), the labels it branches to outside itself,
 * whether it can return, and whether it jumps somewhere it does not name.
 */
function expansionFlow(
  expansion: MacroExpansion<lsp.Range>,
  caseSensitive: boolean,
): {
  hasFlow: boolean;
  targets: string[];
  returns: boolean;
  indirect: boolean;
} {
  const lines = expansion.lines.filter(({ expandedCall }) => !expandedCall);
  const internal = new Set(
    lines.flatMap(({ line }) =>
      line.label ? [symbolKey(line.label.label, caseSensitive)] : [],
    ),
  );
  const flow = {
    hasFlow: internal.size > 0,
    targets: [] as string[],
    returns: false,
    indirect: false,
  };
  for (const { line } of lines) {
    const mnemonic =
      line.mnemonic?.type === "instruction"
        ? canonicalConditionMnemonic(line.mnemonic.instruction).toLowerCase()
        : undefined;
    if (!mnemonic) {
      continue;
    }
    if (routineReturns.has(mnemonic)) {
      flow.hasFlow = true;
      flow.returns = true;
    } else if (isBranchMnemonic(mnemonic)) {
      flow.hasFlow = true;
      const target = branchTarget(line);
      if (target === undefined) {
        flow.indirect = true;
      } else if (!internal.has(symbolKey(target, caseSensitive))) {
        flow.targets.push(target);
      }
    }
  }
  return flow;
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
function registerLiveness(
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
    if (!settle(updateNeeds, FLOW_WORK_LIMIT)) {
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

/** Register effects of a line, in execution order (see `LineSteps`). */
function lineSteps(
  ctx: Context,
  uri: string,
  line: ParsedLine,
  lineText: string,
  inMacroDefinition: boolean,
  inConditional: boolean,
  aliases: AliasResolver,
): LineSteps {
  // A macro body runs where the macro is called, not where it is defined.
  if (inMacroDefinition) {
    return [];
  }
  if (line.mnemonic?.type === "macro") {
    const expansion = expandMacroCall(ctx, uri, line, lineText);
    if (expansion) {
      const steps: LineSteps = [];
      // Branches inside the expansion are not followed, so where it has any,
      // none of its writes is certain to happen.
      const branching = expansionFlow(
        expansion,
        symbolsCaseSensitive(ctx.config),
      ).hasFlow;
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
            lineEffects(
              expanded.line,
              inConditional || branching || conditionalDepth > 0,
              aliases,
            ),
          );
          // Subroutines called from inside a macro are not followed.
          const mnemonic =
            expanded.line.mnemonic?.type === "instruction"
              ? expanded.line.mnemonic.instruction.toLowerCase()
              : undefined;
          if (mnemonic === "bsr" || mnemonic === "jsr") {
            steps.push("unknown");
          }
          // A nested call whose definition could not be found.
          if (expanded.line.mnemonic?.type === "macro") {
            steps.push("unknown");
          }
        }
      }
      if (expansion.incomplete) {
        steps.push("unknown");
      }
      return steps;
    }
    // A call to a macro with no definition the workspace can find may use any
    // register; the ones it is passed are taken as read.
    return [lineEffects(line, inConditional, aliases), "unknown"];
  }
  return [lineEffects(line, inConditional, aliases)];
}

/**
 * What a single line does to each register it names: the bits it reads and
 * replaces (see `RegisterEffect`). A write that may not happen, under `iif`
 * or in an `if` block, replaces nothing.
 */
function lineEffects(
  line: ParsedLine,
  inConditional: boolean,
  aliases: AliasResolver,
): Map<string, RegisterEffect> {
  const effects = new Map<string, RegisterEffect>();
  if (definesRegisters(line)) {
    return effects;
  }
  const conditional = inConditional || line.inlineCondition !== undefined;
  const operands = (line.operands ?? []) as AstNode[];
  for (const [operandIndex, operand] of operands.entries()) {
    for (const found of [operand, ...descendants(operand)].flatMap((node) =>
      registersAt(node, aliases),
    )) {
      const { node, registers } = found;
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
          modifies:
            !!previous?.modifies ||
            access === "write" ||
            access === "readwrite",
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

/**
 * Calls in a range to macros with no definition the workspace can find,
 * directly or from inside a macro that is defined, by the line they are made
 * on. Analysis cannot see which registers such a macro uses.
 */
export function undefinedMacroCalls(
  ctx: Context,
  uri: string,
  range: lsp.Range,
): { line: number; name: string }[] {
  const document = ctx.store.get(uri);
  if (!isProcessed(document)) {
    return [];
  }
  const lineTexts = document.document.getText().split(/\r?\n/g);
  const macroDefinitionLines = collectMacroDefinitionLines(
    document.blocks.blocks,
  );
  const calls: { line: number; name: string }[] = [];
  const last = Math.min(range.end.line, document.parsed.lines.length - 1);
  for (let index = range.start.line; index <= last; index++) {
    const line = document.parsed.lines[index];
    if (line.mnemonic?.type !== "macro" || macroDefinitionLines.has(index)) {
      continue;
    }
    const expansion = expandMacroCall(ctx, uri, line, lineTexts[index] ?? "");
    const names = expansion
      ? expansion.lines.flatMap(({ line: expanded, expandedCall }) =>
          expanded.mnemonic?.type === "macro" && !expandedCall
            ? [expanded.mnemonic.macro]
            : [],
        )
      : [line.mnemonic.macro];
    for (const name of new Set(names)) {
      calls.push({ line: index, name: name.toUpperCase() });
    }
  }
  return calls;
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

/**
 * Registers code stashes on the stack and restores: a `.l` MOVEM or MOVE of
 * a register to `-(sp)` and back from `(sp)+`. Each restore pairs with the
 * nearest save of the register before it, within the region from one
 * non-local label to the next, so a register can be stashed at several
 * points, and a save can have several restores, as on early exits. A save
 * nothing restores, such as an argument pushed for a call, is not paired.
 */
export interface StackSaves {
  /** The lines restoring a register saved on a line, if it is paired. */
  restoresOf(saveLine: number, register: string): number[] | undefined;
  /** The line that saved a register a line restores, if it is paired. */
  saveOf(restoreLine: number, register: string): number | undefined;
  /**
   * Whether a line lies after a pair's save and up to its last restore, so
   * that what it does to the register is undone.
   */
  covers(line: number, register: string): boolean;
  /** The registers a line saves that are paired, with the lines restoring each. */
  restoresAt(saveLine: number): ReadonlyMap<string, number[]> | undefined;
  /** The registers whose pairs `covers` a line. */
  coveredAt(line: number): string[];
}

export function findStackSaves(
  file: ParsedFile,
  blocks: BlockStructure,
  aliases: AliasResolver,
): StackSaves {
  const { lines } = file;
  const macroDefinitionLines = collectMacroDefinitionLines(blocks.blocks);
  const saves = new Map<string, number[]>();
  const restores = new Map<string, number[]>();
  const regionOf: number[] = [];
  let region = 0;
  for (const [index, line] of lines.entries()) {
    if (macroDefinitionLines.has(index)) {
      regionOf.push(region);
      continue;
    }
    if (isNonLocalCodeLabel(line)) {
      region++;
    }
    regionOf.push(region);
    const transfer = stackTransfer(line, aliases);
    for (const register of transfer?.registers ?? []) {
      const key = `${region}:${register}`;
      const lines = transfer!.kind === "save" ? saves : restores;
      (lines.get(key) ?? lines.set(key, []).get(key)!).push(index);
    }
  }

  const restoresBySave = new Map<number, Map<string, number[]>>();
  const saveByRestore = new Map<number, Map<string, number>>();
  // A pair lies within one region, so a line can only lie within the pairs of
  // its own.
  const spans = new Map<number, Map<string, [number, number][]>>();
  for (const [key, restoreLines] of restores) {
    const saveLines = saves.get(key) ?? [];
    const register = key.slice(key.indexOf(":") + 1);
    for (const restore of restoreLines) {
      const save = saveLines.filter((line) => line < restore).at(-1);
      if (save === undefined) {
        continue;
      }
      const byRegister =
        restoresBySave.get(save) ??
        restoresBySave.set(save, new Map()).get(save)!;
      (
        byRegister.get(register) ?? byRegister.set(register, []).get(register)!
      ).push(restore);
      (
        saveByRestore.get(restore) ??
        saveByRestore.set(restore, new Map()).get(restore)!
      ).set(register, save);
    }
  }
  for (const [save, byRegister] of restoresBySave) {
    const region = regionOf[save];
    const regionSpans =
      spans.get(region) ?? spans.set(region, new Map()).get(region)!;
    for (const [register, restoreLines] of byRegister) {
      (
        regionSpans.get(register) ??
        regionSpans.set(register, []).get(register)!
      ).push([save, Math.max(...restoreLines)]);
    }
  }
  const covers = (line: number, register: string) =>
    (spans.get(regionOf[line])?.get(register) ?? []).some(
      ([save, last]) => save < line && line <= last,
    );
  return {
    restoresOf: (line, register) => restoresBySave.get(line)?.get(register),
    saveOf: (line, register) => saveByRestore.get(line)?.get(register),
    covers,
    restoresAt: (line) => restoresBySave.get(line),
    coveredAt: (line) =>
      [...(spans.get(regionOf[line])?.keys() ?? [])].filter((register) =>
        covers(line, register),
      ),
  };
}

/** Whether a line pushes registers onto the stack or pops them off it. */
function stackTransfer(
  line: ParsedLine,
  aliases: AliasResolver,
): { kind: "save" | "restore"; registers: string[] } | undefined {
  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? line.mnemonic.instruction.toLowerCase()
      : undefined;
  const size =
    line.qualifier?.type === "size" ? line.qualifier.size.toLowerCase() : "";
  const operands = (line.operands ?? []) as AstNode[];
  if (
    (mnemonic !== "movem" && mnemonic !== "move" && mnemonic !== "movea") ||
    size !== "l" ||
    operands.length !== 2 ||
    line.inlineCondition !== undefined
  ) {
    return;
  }
  const stack = (operand: AstNode, type: string) =>
    operand.type === type &&
    canonicalGeneralPurposeRegister(
      registerName((operand as AstNode & { register: AstNode }).register),
    ) === "a7";
  const direct = (operand: AstNode) =>
    registersAt(operand, aliases)
      .filter(({ node }) => node === operand)
      .flatMap(({ registers }) => registers);
  const [source, destination] = operands;
  if (stack(destination, "address-register-indirect-predec")) {
    const registers = direct(source);
    return registers.length ? { kind: "save", registers } : undefined;
  }
  if (stack(source, "address-register-indirect-postinc")) {
    const registers = direct(destination);
    return registers.length ? { kind: "restore", registers } : undefined;
  }
}

/** The kinds of node that name general-purpose registers. */
interface NodeRegisters {
  /** The node standing for the registers, whose access they share. */
  node: AstNode;
  registers: string[];
  kind: "explicit" | "register-list" | "alias";
}

/**
 * Names `equr`/`equrl`/`reg` aliases resolve to, as general-purpose
 * registers, or undefined for a name that is not such an alias.
 */
type AliasResolver = (name: string) => string[] | undefined;

/**
 * Resolves register aliases through the symbols visible from a document,
 * remembering each answer.
 */
export function createAliasResolver(ctx: Context, uri: string): AliasResolver {
  const cache = new Map<string, string[] | undefined>();
  return (name) => {
    if (!cache.has(name)) {
      const definition = resolveDefinitionByName(uri, name, ctx);
      cache.set(
        name,
        (definition?.type === DefinitionType.Register ||
          definition?.type === DefinitionType.RegisterList) &&
          definition.declaration
          ? aliasedRegisters(definition.declaration)
          : undefined,
      );
    }
    return cache.get(name);
  };
}

/**
 * The general-purpose registers an alias definition line names, such as `d0`
 * in `count equr d0` or the list in `saved reg d2-d3/a2`. Directive operands
 * parse as expressions, so the operand's text is read as a register list.
 */
function aliasedRegisters(declaration: string): string[] | undefined {
  const operand = parseLine(declaration).value.operands?.[0];
  if (!operand) {
    return;
  }
  const registers = parseRegisterList(
    declaration.slice(operand.loc.start, operand.loc.end),
  );
  return registers?.length
    ? registers.map((register) => canonicalGeneralPurposeRegister(register)!)
    : undefined;
}

function listedRegisters(node: AstNode): string[] {
  const registers = (node as AstNode & { registers?: unknown }).registers;
  return Array.isArray(registers)
    ? registers.flatMap((item) => canonicalGeneralPurposeRegister(item) ?? [])
    : [];
}

/**
 * The general-purpose registers a node names: a register, a register list, or
 * an alias for either. An alias is only taken where a register can stand: as a
 * whole operand, such as `count` in `move.w count,d1`, or as an addressing
 * mode's base or index register, such as `ptr` in `(ptr)+`.
 */
function registersAt(node: AstNode, aliases: AliasResolver): NodeRegisters[] {
  const single = canonicalGeneralPurposeRegister(registerName(node));
  if (single) {
    return [{ node, registers: [single], kind: "explicit" }];
  }
  if (node.type === "register-list") {
    const registers = listedRegisters(node);
    return registers.length ? [{ node, registers, kind: "register-list" }] : [];
  }
  const found: NodeRegisters[] = [];
  const fields = node as AstNode & {
    address?: AstNode & { name?: unknown };
    addressSize?: unknown;
    register?: unknown;
    baseRegister?: unknown;
    indexRegister?: unknown;
  };
  if (
    node.type === "absolute-address" &&
    fields.address?.type === "symbol" &&
    fields.addressSize === undefined &&
    typeof fields.address.name === "string"
  ) {
    const registers = aliases(fields.address.name);
    if (registers) {
      found.push({ node, registers, kind: "alias" });
    }
  }
  for (const value of [
    fields.register,
    fields.baseRegister,
    fields.indexRegister,
  ]) {
    const symbol = value as (AstNode & { name?: unknown }) | undefined;
    if (symbol?.type === "symbol" && typeof symbol.name === "string") {
      const registers = aliases(symbol.name);
      if (registers) {
        found.push({ node: symbol, registers, kind: "alias" });
      }
    }
  }
  return found;
}

/** Directives that define register aliases rather than use registers. */
const registerDefinitionDirectives = new Set([
  "equr",
  "equrl",
  "fequr",
  "fequrl",
  "freg",
  "reg",
]);

function definesRegisters(line: ParsedLine): boolean {
  return (
    line.mnemonic?.type === "directive" &&
    registerDefinitionDirectives.has(line.mnemonic.directive.toLowerCase())
  );
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

  if (mnemonic === "movem") {
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

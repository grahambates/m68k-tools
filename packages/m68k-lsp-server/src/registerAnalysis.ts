import type {
  RegisterAccess,
  RegisterUsage,
  RegisterUsageReference,
  RegisterUsageParams,
  RegisterUsageResult,
  RegisterRangesResult,
  RoutineRangeParams,
  RoutineRangeResult,
} from "@m68k-lsp/protocol";
import * as lsp from "vscode-languageserver";
import { expandMacro, macroInvocation } from "m68k-parser";
import type {
  Block,
  ExpandedMacroLine,
  MacroDefinition,
  ParsedLine,
} from "m68k-parser";
import { type AstNode, childNodes, walkFile, walkLine } from "./ast";
import { type Context } from "./context";
import { isProcessed } from "./DocumentProcessor";
import { getUnitFilesByDistance } from "./files";
import { locationAsRange } from "./geometry";

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
    const definition = findMacroDefinition(
      line.mnemonic.macro,
      params.textDocument.uri,
      ctx,
    );
    if (!definition) {
      continue;
    }
    const lineText = lineTexts[index] ?? "";
    const expansion = expandMacro(
      definition,
      macroInvocation<lsp.Range>(line, lineText, (text, loc) => ({
        origin: locationAsRange(loc),
        literal: !!canonicalGeneralPurposeRegister(text),
      })),
      {
        resolve: (name) =>
          findMacroDefinition(name, params.textDocument.uri, ctx),
        fallbackOrigin: callRange,
      },
    );
    for (const expanded of expansion.lines)
      addExpandedRegisters(expanded.line, expanded, callRange, usages);
    incomplete ||= expansion.incomplete;
  }

  const reachability = params.position
    ? reachableLinesAfterPosition(
        document.parsed.lines,
        params.range,
        params.position,
      )
    : undefined;
  return {
    documentVersion: document.document.version,
    ...(incomplete ? { incomplete: true } : {}),
    registers: Array.from(usages, ([name, references]) => {
      const usage = summariseUsage(name, references);
      if (reachability) {
        usage.availability =
          reachability.touched.has(name) ||
          references.some((reference) =>
            reachability.lines.has(reference.range.start.line),
          )
            ? "unavailable"
            : incomplete || reachability.unknown
              ? "unknown"
              : "available";
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

  let startLine: number | undefined;
  for (
    let index = Math.min(
      params.position.line,
      document.parsed.lines.length - 1,
    );
    index >= 0;
    index--
  ) {
    const line = document.parsed.lines[index];
    if (isNonLocalCodeLabel(line)) {
      startLine = index;
      break;
    }
  }
  startLine ??= 0;
  const start = document.parsed.lines[startLine];
  const label = isNonLocalCodeLabel(start) ? start.label : undefined;

  for (
    let index = params.position.line;
    index < document.parsed.lines.length;
    index++
  ) {
    const line = document.parsed.lines[index];
    const mnemonic = line.mnemonic;
    if (
      mnemonic?.type === "instruction" &&
      routineReturns.has(mnemonic.instruction.toLowerCase())
    ) {
      return {
        range: lsp.Range.create(
          lsp.Position.create(startLine, 0),
          lsp.Position.create(index, mnemonic.loc.end),
        ),
        label: label?.label ?? "Start of file",
      };
    }
  }

  return {
    range: lsp.Range.create(
      lsp.Position.create(startLine, 0),
      document.document.positionAt(document.document.getText().length),
    ),
    label: label?.label ?? "Start of file",
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
function isNonLocalCodeLabel(line: ParsedLine): boolean {
  return (
    line.label !== undefined &&
    line.label.scope !== "local" &&
    line.mnemonic?.type !== "directive"
  );
}

function reachableLinesAfterPosition(
  lines: ParsedLine[],
  scope: lsp.Range,
  position: lsp.Position,
): { lines: Set<number>; touched: Set<string>; unknown: boolean } {
  const startLine = Math.max(scope.start.line, position.line + 1);
  const endLine = Math.min(scope.end.line, lines.length - 1);
  if (startLine > endLine) {
    return { lines: new Set(), touched: new Set(), unknown: false };
  }

  const labels = collectControlFlowLabels(lines, 0, lines.length - 1);
  const reachable = new Set<number>();
  const touched = new Set<string>();
  let unknown = false;
  const pending = [startLine];
  while (pending.length) {
    const lineIndex = pending.pop()!;
    if (
      lineIndex < 0 ||
      lineIndex >= lines.length ||
      reachable.has(lineIndex)
    ) {
      continue;
    }
    reachable.add(lineIndex);
    const line = lines[lineIndex];
    addTouchedRegisters(line, touched);
    const mnemonic =
      line.mnemonic?.type === "instruction"
        ? line.mnemonic.instruction.toLowerCase()
        : undefined;
    if (mnemonic === "bsr" || mnemonic === "jsr") {
      const target = controlFlowTarget(line);
      const targetLine =
        target === undefined
          ? undefined
          : labels.get(labelKey(target, labels.globalAt[lineIndex]));
      if (targetLine === undefined) {
        unknown = true;
      } else {
        pending.push(targetLine);
      }
    }
    if (!mnemonic || !routineReturns.has(mnemonic)) {
      if (mnemonic && isBranchMnemonic(mnemonic)) {
        const target = branchTarget(line);
        const targetLine =
          target === undefined
            ? undefined
            : labels.get(labelKey(target, labels.globalAt[lineIndex]));
        if (targetLine === undefined) {
          return {
            lines: new Set(
              Array.from(
                { length: endLine - scope.start.line + 1 },
                (_, offset) => scope.start.line + offset,
              ),
            ),
            touched: new Set(generalPurposeRegisters),
            unknown: false,
          };
        }
        pending.push(targetLine);
      }
      if (mnemonic !== "bra" && mnemonic !== "jmp") {
        pending.push(lineIndex + 1);
      }
    }
  }
  return { lines: reachable, touched, unknown };
}

function addTouchedRegisters(line: ParsedLine, touched: Set<string>): void {
  for (const node of walkLine(line)) {
    const register = canonicalGeneralPurposeRegister(registerName(node));
    if (register) {
      touched.add(register);
      continue;
    }
    if (node.type !== "register-list") {
      continue;
    }
    const registers = (node as AstNode & { registers?: unknown }).registers;
    if (Array.isArray(registers)) {
      for (const item of registers) {
        const listed = canonicalGeneralPurposeRegister(item);
        if (listed) {
          touched.add(listed);
        }
      }
    }
  }
}

interface ControlFlowLabels extends Map<string, number> {
  globalAt: Array<string | undefined>;
}

function collectControlFlowLabels(
  lines: ParsedLine[],
  startLine: number,
  endLine: number,
): ControlFlowLabels {
  const labels = new Map<string, number>() as ControlFlowLabels;
  labels.globalAt = [];
  let global: string | undefined;
  for (let index = startLine; index <= endLine; index++) {
    const label = lines[index].label;
    if (label) {
      if (label.scope === "local") {
        labels.set(labelKey(label.label, global), index);
      } else if (isNonLocalCodeLabel(lines[index])) {
        global = label.label.toLowerCase();
        labels.set(global, index);
      }
    }
    labels.globalAt[index] = global;
  }
  return labels;
}

function labelKey(label: string, global?: string): string {
  const name = label.toLowerCase();
  return name.startsWith(".") || name.endsWith("$")
    ? `${global ?? ""}:${name}`
    : name;
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

function descendants(node: AstNode): AstNode[] {
  const result: AstNode[] = [];
  for (const child of childNodes(node)) {
    result.push(child, ...descendants(child));
  }
  return result;
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
  const key = name.toLowerCase();
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
    read: references.some(({ access }) => includesRead(access)),
    written: references.some(({ access }) => includesWrite(access)),
    input:
      firstAccess === undefined || firstAccess === "unknown"
        ? undefined
        : includesRead(firstAccess),
  };
}

function registerAccess(node: AstNode, line: ParsedLine): RegisterAccess {
  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? line.mnemonic.instruction.toLowerCase()
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

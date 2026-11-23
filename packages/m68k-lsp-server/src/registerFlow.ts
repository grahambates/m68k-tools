import {
  analyzeLocalLabelScopes,
  type BlockStructure,
  canonicalConditionMnemonic,
  isLocalLabelName,
  type MacroExpansion,
  type ParsedFile,
  type ParsedLine,
  symbolKey,
} from "m68k-parser";
import type * as lsp from "vscode-languageserver";
import { type AstNode, descendants } from "./ast";
import { symbolsCaseSensitive } from "./config";
import type { Context } from "./context";
import {
  collectMacroDefinitionLines,
  expandMacroCall,
  isNonLocalCodeLabel,
} from "./registerSource";

export const routineReturns = new Set(["rts", "rte", "rtr"]);

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
export function expansionFlow(
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
export function collectControlFlowLabels(
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

export function branchTarget(line: ParsedLine): string | undefined {
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

export function isBranchMnemonic(mnemonic: string): boolean {
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

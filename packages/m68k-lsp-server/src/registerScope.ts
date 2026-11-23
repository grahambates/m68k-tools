import type { BlockRangeParams, BlockRangeResult } from "@m68k-lsp/protocol";
import {
  canonicalConditionMnemonic,
  enclosingBlocks,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import * as lsp from "vscode-languageserver";
import { type AstNode, walkLine } from "./ast";
import { symbolsCaseSensitive } from "./config";
import type { Context } from "./context";
import { isProcessed } from "./DocumentProcessor";
import {
  branchTarget,
  collectControlFlowLabels,
  isBranchMnemonic,
  routineReturns,
} from "./registerFlow";
import {
  collectMacroDefinitionLines,
  isNonLocalCodeLabel,
} from "./registerSource";

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

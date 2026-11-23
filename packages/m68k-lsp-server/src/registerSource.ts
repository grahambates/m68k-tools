import {
  type Block,
  type ExpandedMacroLine,
  expandMacro,
  locationAsRange,
  type MacroExpansion,
  macroInvocation,
  type ParsedLine,
} from "m68k-parser";
import type * as lsp from "vscode-languageserver";
import type { AstNode } from "./ast";
import type { Context } from "./context";
import { isProcessed } from "./DocumentProcessor";
import { findMacroDefinition } from "./macros";

export const generalPurposeRegisters = new Set([
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

export function isNonLocalCodeLabel(line: ParsedLine): boolean {
  return (
    line.label !== undefined &&
    line.label.scope !== "local" &&
    line.mnemonic?.type !== "directive"
  );
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

export function expandMacroCall(
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
    definition.definition,
    macroInvocation<lsp.Range>(line, lineText, (text, loc) => ({
      origin: locationAsRange(loc),
      literal: !!canonicalGeneralPurposeRegister(text),
    })),
    {
      resolve: (name) => findMacroDefinition(name, uri, ctx)?.definition,
      fallbackOrigin: locationAsRange(line.mnemonic.loc),
    },
  );
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

export type ExpandedLine = ExpandedMacroLine<lsp.Range>;

export function collectMacroDefinitionLines(blocks: Block[]): Set<number> {
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

// Only a whole, unchanged register argument can safely be edited at its source.
// Overlapping spans still provide useful navigation for constructed registers.
export function literalRegisterSpan(
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

export function sourceRangeForLocation(
  location: AstNode["loc"],
  spans: ExpandedLine["spans"],
): lsp.Range | undefined {
  return spans.find(
    (span) => location.start < span.end && span.start < location.end,
  )?.origin;
}

export function rangesOverlap(left: lsp.Range, right: lsp.Range): boolean {
  return (
    comparePositions(left.start, right.end) < 0 &&
    comparePositions(right.start, left.end) < 0
  );
}

export function comparePositions(
  left: lsp.Position,
  right: lsp.Position,
): number {
  return left.line - right.line || left.character - right.character;
}

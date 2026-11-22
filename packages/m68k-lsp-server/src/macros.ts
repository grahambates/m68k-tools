import type { MacroExpansionResult } from "@m68k-lsp/protocol";
import { expandMacro, macroInvocation, symbolKey } from "m68k-parser";
import { Location, Range } from "vscode-languageserver";
import { symbolsCaseSensitive } from "./config";
import { type Context } from "./context";
import type { ProcessedDocument } from "./DocumentProcessor";
import { getUnitFilesByDistance } from "./files";

export function findMacroDefinition(
  name: string,
  documentUri: string,
  ctx: Context,
) {
  const key = symbolKey(name, symbolsCaseSensitive(ctx.config));
  for (const uri of [
    documentUri,
    ...getUnitFilesByDistance(documentUri, ctx),
  ]) {
    const definition = ctx.store.get(uri)?.macros.get(key);
    if (definition) return { uri, definition };
  }
}

export function expandMacroAtLine(
  ctx: Context,
  processed: ProcessedDocument,
  lineNumber: number,
): MacroExpansionResult | undefined {
  const line = processed.parsed.lines[lineNumber];
  if (line?.mnemonic?.type !== "macro") return;

  const { uri } = processed;
  const found = findMacroDefinition(line.mnemonic.macro, uri, ctx);
  if (!found) return;

  const lineRange = Range.create(lineNumber, 0, lineNumber + 1, 0);
  const source = processed.document.getText(lineRange);
  const expansion = expandMacro(
    found.definition,
    macroInvocation(line, source),
    {
      resolve: (name) => findMacroDefinition(name, uri, ctx)?.definition,
    },
  );
  const definitionLine = found.definition.start;
  return {
    name: found.definition.name,
    definition: Location.create(
      found.uri,
      Range.create(definitionLine, 0, definitionLine, 0),
    ),
    lines: expansion.lines.map(({ text, expandedCall }) =>
      expandedCall ? `; ${text.trim()}` : text,
    ),
    incomplete:
      expansion.incomplete ||
      expansion.lines.some(
        ({ line, expandedCall }) =>
          line.mnemonic?.type === "macro" && !expandedCall,
      ),
  };
}

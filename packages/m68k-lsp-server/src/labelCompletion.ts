import { basename } from "path";
import * as lsp from "vscode-languageserver";
import { type Context } from "./context";
import { type ProcessedDocument } from "./DocumentProcessor";
import { getUnitFiles } from "./files";
import { collectMacroDefinitionLines } from "./registerSource";
import {
  type Definition,
  DefinitionType,
  isLocalLabel,
  keyFor,
  type NamedSymbol,
  resolveDefinitionByName,
} from "./symbols";

/**
 * Names to offer while a label is being defined: those the code already uses
 * but nothing defines yet, as when `bne .loop` is written before `.loop`.
 *
 * A local label is offered when the routine it would belong to refers to it,
 * a global one when this file or its assembly unit does and nothing in the
 * unit defines it. Nearest uses come first.
 *
 * The label on the cursor's own line is ignored as a definition, since it is
 * the one being typed: `.lo` on its way to `.loop` already parses as a label.
 * Uses inside macro bodies are ignored, as their names are only resolved where
 * the macro is expanded.
 *
 * @param range Text the chosen name replaces: the label typed so far.
 */
export function undefinedLabelCompletions(
  ctx: Context,
  processed: ProcessedDocument,
  line: number,
  range: lsp.Range,
): lsp.CompletionItem[] {
  const { symbols, uri } = processed;
  const inMacro = collectMacroDefinitionLines(processed.blocks.blocks);
  const usable = (ref: NamedSymbol) =>
    ref.location.uri !== uri || !inMacro.has(ref.location.range.start.line);

  const labelLines = [...symbols.definitions.values()]
    .filter(
      (def) =>
        def.type === DefinitionType.Label &&
        !isLocalLabel(def.name) &&
        def.selectionRange.start.line !== line,
    )
    .map((def) => def.selectionRange.start.line);
  const scopeStart = Math.max(-1, ...labelLines.filter((l) => l < line));
  const scopeEnd = Math.min(Infinity, ...labelLines.filter((l) => l > line));
  const inScope = (lineNumber: number) =>
    lineNumber >= scopeStart && lineNumber < scopeEnd;

  // Locals are stored under the label before them, or among the document's
  // own definitions ahead of the first one. Which label that is can be the
  // one being typed, so every routine's are read and placed by line.
  const definedLocals = new Set<string>();
  const localDefinitions: Definition[] = [
    ...symbols.definitions.values(),
  ].flatMap((def) =>
    isLocalLabel(def.name) ? [def] : [...(def.locals?.values() ?? [])],
  );
  for (const def of localDefinitions) {
    const defLine = def.selectionRange.start.line;
    if (defLine !== line && inScope(defLine)) {
      definedLocals.add(keyFor(ctx, def.name));
    }
  }

  const items = new Map<string, lsp.CompletionItem>();
  const offer = (key: string, ref: NamedSymbol, distance: number) => {
    const existing = items.get(key);
    if (existing && Number(existing.sortText) <= distance) return;
    const where = ref.location.range.start.line + 1;
    items.set(key, {
      label: ref.name,
      kind: lsp.CompletionItemKind.Reference,
      detail:
        ref.location.uri === uri
          ? `(undefined label) used on line ${where}`
          : `(undefined label) used in ${basename(ref.location.uri)}:${where}`,
      sortText: String(distance).padStart(8, "0"),
      textEdit: lsp.TextEdit.replace(range, ref.name),
    });
  };

  for (const [key, refs] of symbols.references) {
    const local = refs.filter(
      (ref) =>
        isLocalLabel(ref.name) &&
        usable(ref) &&
        inScope(ref.location.range.start.line),
    );
    if (local.length && !definedLocals.has(key)) {
      for (const ref of local) {
        offer(key, ref, Math.abs(ref.location.range.start.line - line));
      }
    }
  }

  const unit = [uri, ...getUnitFiles(uri, ctx)];
  for (const fileUri of unit) {
    const references = ctx.store.get(fileUri)?.symbols.references;
    for (const [key, refs] of references ?? []) {
      const global = refs.filter(
        (ref) => !isLocalLabel(ref.name) && usable(ref),
      );
      if (!global.length || isDefinedElsewhere(ctx, uri, global[0], line)) {
        continue;
      }
      for (const ref of global) {
        // Uses in other files sort after every use in this one.
        const distance =
          ref.location.uri === uri
            ? Math.abs(ref.location.range.start.line - line)
            : 1e6 + ref.location.range.start.line;
        offer(key, ref, distance);
      }
    }
  }

  return [...items.values()];
}

/** Whether a name is defined somewhere other than the line being typed. */
function isDefinedElsewhere(
  ctx: Context,
  uri: string,
  ref: NamedSymbol,
  line: number,
): boolean {
  const def = resolveDefinitionByName(uri, ref.name, ctx);
  return (
    def !== undefined &&
    !(def.location.uri === uri && def.selectionRange.start.line === line)
  );
}

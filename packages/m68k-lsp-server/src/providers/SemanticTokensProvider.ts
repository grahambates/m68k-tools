import { isLocalLabelName } from "m68k-parser";
import * as lsp from "vscode-languageserver";
import type { Provider } from ".";
import type { Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { getUnitFilesByDistance } from "../files";
import { type Definition, DefinitionType, type NamedSymbol } from "../symbols";

const tokenTypes = ["label", "variable", "macro", "register", "namespace"];
const tokenModifiers = ["declaration", "readonly"];
const declaration = 1 << 0;
const readonly = 1 << 1;
const tokenTypeByDefinition: Record<DefinitionType, string> = {
  [DefinitionType.Label]: "label",
  [DefinitionType.XRef]: "label",
  [DefinitionType.Constant]: "variable",
  [DefinitionType.Variable]: "variable",
  [DefinitionType.Offset]: "variable",
  [DefinitionType.Macro]: "macro",
  [DefinitionType.Register]: "register",
  [DefinitionType.RegisterList]: "register",
  [DefinitionType.Section]: "namespace",
};

type Occurrence = { key: string; range: lsp.Range } & (
  | { definition: Definition; reference?: never }
  | { reference: NamedSymbol; definition?: never }
);

export default class SemanticTokensProvider implements Provider {
  constructor(private readonly ctx: Context) {}

  onSemanticTokens({
    textDocument: { uri },
  }: lsp.SemanticTokensParams): lsp.SemanticTokens {
    const document = this.ctx.store.get(uri);
    const builder = new lsp.SemanticTokensBuilder();
    if (!isProcessed(document)) return builder.build();

    const { definitions, references } = document.symbols;
    const occurrences: Occurrence[] = [];
    for (const [key, definition] of definitions) {
      occurrences.push({ key, definition, range: definition.selectionRange });
      for (const [localKey, local] of definition.locals ?? []) {
        occurrences.push({
          key: localKey,
          definition: local,
          range: local.selectionRange,
        });
      }
    }
    for (const [key, symbols] of references) {
      for (const reference of symbols) {
        occurrences.push({ key, reference, range: reference.location.range });
      }
    }
    occurrences.sort((a, b) => {
      const start = a.range.start;
      const other = b.range.start;
      return (
        start.line - other.line ||
        start.character - other.character ||
        Number(!!b.definition) - Number(!!a.definition)
      );
    });

    // Look up each global name once, in the same assembly-unit order as
    // go to definition. Local labels use only the current routine's scope.
    const unit = getUnitFilesByDistance(uri, this.ctx).map(
      (file) => this.ctx.store.get(file)?.symbols.definitions,
    );
    const resolved = new Map<string, Definition | undefined>(definitions);
    let scope: Definition | undefined;
    let lastLine = -1;
    let lastEnd = 0;
    for (const occurrence of occurrences) {
      const { key, definition, reference } = occurrence;
      const { start, end } = occurrence.range;
      if (
        definition?.type === DefinitionType.Label &&
        !isLocalLabelName(definition.name)
      )
        scope = definition;
      if (
        end.line !== start.line ||
        end.character <= start.character ||
        (start.line === lastLine && start.character < lastEnd)
      )
        continue;

      let target = definition;
      if (reference) {
        if (isLocalLabelName(reference.name)) {
          target = scope?.locals?.get(key);
        } else {
          if (!resolved.has(key)) {
            resolved.set(
              key,
              unit.find((definitions) => definitions?.has(key))?.get(key),
            );
          }
          target = resolved.get(key);
        }
        // Unrecognised mnemonics are parsed as potential macro calls.
        const mnemonic = document.parsed.lines[start.line]?.mnemonic;
        if (
          mnemonic?.type === "macro" &&
          mnemonic.loc.start === start.character &&
          target?.type !== DefinitionType.Macro
        )
          continue;
      }
      if (!target) continue;

      const immutable =
        target.type === DefinitionType.Constant ||
        target.type === DefinitionType.Offset;
      const modifiers =
        (definition ? declaration : 0) | (immutable ? readonly : 0);
      builder.push(
        start.line,
        start.character,
        end.character - start.character,
        tokenTypes.indexOf(tokenTypeByDefinition[target.type]),
        modifiers,
      );
      lastLine = start.line;
      lastEnd = end.character;
    }
    return builder.build();
  }

  register(
    connection: lsp.Connection,
    capabilities: lsp.ClientCapabilities,
  ): lsp.ServerCapabilities {
    connection.languages.semanticTokens.on(this.onSemanticTokens.bind(this));
    if (capabilities.workspace?.semanticTokens?.refreshSupport) {
      // Collapse bulk indexing and a run of edits into one refresh request.
      let pending: ReturnType<typeof setTimeout> | undefined;
      this.ctx.scheduleSemanticTokensRefresh = () => {
        clearTimeout(pending);
        pending = setTimeout(() => {
          void connection
            .sendRequest(lsp.SemanticTokensRefreshRequest.type)
            .catch((error) =>
              this.ctx.logger.warn(
                `Unable to refresh semantic tokens: ${String(error)}`,
              ),
            );
        }, 200);
      };
    }
    return {
      semanticTokensProvider: {
        legend: { tokenTypes, tokenModifiers },
        full: true,
      },
    };
  }
}

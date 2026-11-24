import * as lsp from "vscode-languageserver";
import { parseExpression, symbolKey } from "m68k-parser";
import { type Provider } from ".";
import {
  colourConstants,
  colourLiteral,
  definitionColours,
  definitionLiteral,
  documentColours,
  type ConstantLookup,
} from "../amigaColours";
import { symbolsCaseSensitive } from "../config";
import { type Context } from "../context";
import { analyzeDocumentConditionals } from "../documentConditionals";
import { configFor } from "../documentConfigs";
import { isProcessed, type ProcessedDocument } from "../DocumentProcessor";
import { getUnitFiles } from "../files";
import { DefinitionType } from "../symbols";

/**
 * Colour swatches and the colour picker for values written to Amiga colour
 * registers: at each value written, whether a literal or a constant, and at
 * the definition of a constant used as a colour.
 */
export default class ColorProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  private key(uri: string) {
    const caseSensitive = symbolsCaseSensitive(configFor(this.ctx, uri));
    return (name: string) => symbolKey(name, caseSensitive);
  }

  private constants(processed: ProcessedDocument): ConstantLookup {
    const { constants } = analyzeDocumentConditionals(
      this.ctx,
      processed.uri,
      processed.parsed,
      processed.blocks,
    );
    const key = this.key(processed.uri);
    return (name) => constants.get(key(name));
  }

  async onDocumentColor({
    textDocument,
  }: lsp.DocumentColorParams): Promise<lsp.ColorInformation[]> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) return [];
    const constant = this.constants(processed);
    const key = this.key(processed.uri);

    // Constants written as colours here or in another open file of the same
    // assembly unit, such as a palette defined in an include.
    const colourNames = new Set<string>();
    for (const uri of [
      processed.uri,
      ...getUnitFiles(processed.uri, this.ctx),
    ]) {
      const doc = this.ctx.store.get(uri);
      if (!isProcessed(doc)) continue;
      const lookup = doc === processed ? constant : this.constants(doc);
      for (const name of colourConstants(doc.parsed, lookup))
        colourNames.add(key(name));
    }

    return [
      ...documentColours(processed.parsed, constant),
      ...definitionColours(processed.parsed, (name) =>
        colourNames.has(key(name)),
      ),
    ];
  }

  async onColorPresentation({
    textDocument,
    color,
    range,
  }: lsp.ColorPresentationParams): Promise<lsp.ColorPresentation[]> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) return [];
    const caseOption = configFor(this.ctx, textDocument.uri).format.case;
    const hexCase =
      typeof caseOption === "string" ? caseOption : caseOption?.hex;
    const text = processed.document.getText(range);
    const { value: expr, errors } = parseExpression(text);
    if (errors.length) return [];

    if (expr.type === "numeric-literal") {
      const label = colourLiteral(color, text, hexCase);
      return [{ label, textEdit: lsp.TextEdit.replace(range, label) }];
    }

    // A constant: change it where it is defined, leaving the use as it is.
    // Only a definition in this document can be edited from here.
    if (expr.type !== "symbol") return [];
    const definition = processed.symbols.definitions.get(
      this.key(processed.uri)(expr.name),
    );
    if (
      definition?.type !== DefinitionType.Constant ||
      definition.location.uri !== processed.uri
    )
      return [];
    const literal = definitionLiteral(
      processed.parsed,
      definition.selectionRange.start.line,
    );
    if (!literal) return [];
    const label = colourLiteral(
      color,
      processed.document.getText(literal.range),
      hexCase,
    );
    return [
      {
        label,
        textEdit: lsp.TextEdit.replace(range, text),
        additionalTextEdits: [lsp.TextEdit.replace(literal.range, label)],
      },
    ];
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onDocumentColor(this.onDocumentColor.bind(this));
    connection.onColorPresentation(this.onColorPresentation.bind(this));
    return { colorProvider: true };
  }
}

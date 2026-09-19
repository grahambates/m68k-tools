import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { nodeAtPosition, walkFile } from "../ast";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { locationAsRange } from "m68k-parser";
import { registerName } from "../registerAnalysis";
import { symbolAtPosition } from "../symbols";

export default class DocumentHighlightProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onDocumentHighlight({
    textDocument,
    position,
  }: lsp.DocumentHighlightParams): Promise<
    lsp.DocumentHighlight[] | undefined
  > {
    const { store: processed } = this.ctx;
    const document = processed.get(textDocument.uri);
    const docSymbols = document?.symbols;
    if (!docSymbols) {
      return;
    }

    if (isProcessed(document)) {
      const path = nodeAtPosition(document.parsed, position);
      const register = path && registerName(path.node);
      if (register) {
        return walkFile(document.parsed)
          .filter(({ node }) => registerName(node) === register)
          .map(({ node }) =>
            lsp.DocumentHighlight.create(
              locationAsRange(node.loc),
              lsp.DocumentHighlightKind.Read,
            ),
          );
      }
    }

    // Find reference or definition at position
    const foundSymbol = symbolAtPosition(docSymbols, position);
    if (!foundSymbol) {
      return [];
    }

    const results: lsp.DocumentHighlight[] = [];

    const refs = docSymbols.references.get(foundSymbol.name);
    if (refs) {
      for (const ref of refs) {
        results.push(
          lsp.DocumentHighlight.create(
            ref.location.range,
            lsp.DocumentHighlightKind.Read,
          ),
        );
      }
    }
    const def = docSymbols.definitions.get(foundSymbol.name);
    if (def) {
      results.push(
        lsp.DocumentHighlight.create(
          def.selectionRange,
          lsp.DocumentHighlightKind.Write,
        ),
      );
    }

    return results;
  }

  register(connection: lsp.Connection) {
    connection.onDocumentHighlight(this.onDocumentHighlight.bind(this));
    return { documentHighlightProvider: true };
  }
}

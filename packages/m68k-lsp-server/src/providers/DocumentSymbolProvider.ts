import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { type DefinitionType, symbolKindMappings } from "../symbols";

export default class DocumentSymbolProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onDocumentSymbol({
    textDocument,
  }: lsp.DocumentSymbolParams): Promise<lsp.DocumentSymbol[]> {
    const docSymbols = this.ctx.store.get(textDocument.uri)?.symbols;
    if (!docSymbols) {
      return [];
    }

    const results: lsp.DocumentSymbol[] = [];

    for (const def of docSymbols.definitions.values()) {
      const symbol = lsp.DocumentSymbol.create(
        def.name,
        typeDetails[def.type],
        symbolKindMappings[def.type],
        def.location.range,
        def.selectionRange,
      );

      if (def.locals) {
        const locals = Array.from(def.locals.values());
        symbol.children = locals.map((local) =>
          lsp.DocumentSymbol.create(
            local.name,
            undefined,
            symbolKindMappings[local.type],
            local.location.range,
            local.selectionRange,
          ),
        );
      }

      results.push(symbol);
    }

    return results;
  }

  register(connection: lsp.Connection) {
    connection.onDocumentSymbol(this.onDocumentSymbol.bind(this));
    return {
      documentSymbolProvider: true,
    };
  }
}

const typeDetails: Partial<Record<DefinitionType, string>> = {
  xref: "external",
  register: "register",
  register_list: "register list",
  offset: "offset",
  macro: "macro",
};

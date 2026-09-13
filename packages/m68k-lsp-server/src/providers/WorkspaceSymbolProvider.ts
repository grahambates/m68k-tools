import * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import { symbolKindMappings } from "../symbols";

export default class WorkspaceSymbolProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onWorkspaceSymbol({
    query,
  }: lsp.WorkspaceSymbolParams): Promise<lsp.SymbolInformation[]> {
    const results: lsp.SymbolInformation[] = [];
    const queryText = query.toLowerCase();
    for (const processedDoc of this.ctx.store.values()) {
      for (const [, def] of processedDoc.symbols.definitions) {
        if (def.name.toLowerCase().includes(queryText)) {
          results.push(
            lsp.SymbolInformation.create(
              def.name,
              symbolKindMappings[def.type],
              def.location.range,
              def.location.uri,
            ),
          );
        }
      }
    }

    return results;
  }

  register(connection: lsp.Connection) {
    connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this));
    return {
      workspaceSymbolProvider: true,
    };
  }
}

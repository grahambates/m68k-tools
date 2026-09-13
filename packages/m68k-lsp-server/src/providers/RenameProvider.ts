import type * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import {
  getDefinitions,
  getReferences,
  isDefinition,
  symbolAtPosition,
} from "../symbols";

export default class RenameProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onPrepareRename({
    textDocument,
    position,
  }: lsp.PrepareRenameParams): Promise<lsp.Range | null> {
    const docSymbols = this.ctx.store.get(textDocument.uri)?.symbols;
    if (!docSymbols) {
      return null;
    }
    const foundSymbol = symbolAtPosition(docSymbols, position);
    if (!foundSymbol) {
      return null;
    }

    return isDefinition(foundSymbol)
      ? foundSymbol.selectionRange
      : foundSymbol.location.range;
  }

  async onRenameRequest({
    textDocument,
    position,
    newName,
  }: lsp.RenameParams): Promise<lsp.WorkspaceEdit> {
    const changes: Record<string, lsp.TextEdit[]> = {};

    const defs = await getDefinitions(textDocument.uri, position, this.ctx);
    for (const def of defs) {
      if (!changes[def.location.uri]) {
        changes[def.location.uri] = [];
      }
      changes[def.location.uri].push({
        newText: newName,
        range: def.selectionRange,
      });
    }

    const refs = await getReferences(textDocument.uri, position, this.ctx);
    for (const ref of refs) {
      if (!changes[ref.location.uri]) {
        changes[ref.location.uri] = [];
      }
      changes[ref.location.uri].push({
        newText: newName,
        range: ref.location.range,
      });
    }

    return { changes };
  }

  register(connection: lsp.Connection) {
    connection.onPrepareRename(this.onPrepareRename.bind(this));
    connection.onRenameRequest(this.onRenameRequest.bind(this));
    return {
      renameProvider: {
        prepareProvider: true,
      },
    };
  }
}

import type * as lsp from "vscode-languageserver";

import { type ProcessedDocumentStore } from "./DocumentProcessor";
import { type Config, mergeConfig, defaultConfig } from "./config";

export interface Context {
  store: ProcessedDocumentStore;
  /** Identifies the newest open/index operation for each document. */
  documentUpdates: Map<string, symbol>;
  workspaceFolders: lsp.WorkspaceFolder[];
  logger: lsp.Logger;
  connection: lsp.Connection;
  config: Config;
}

export async function createContext(
  workspaceFolders: lsp.WorkspaceFolder[],
  logger: lsp.Logger,
  connection: lsp.Connection,
  config: Partial<Config>,
): Promise<Context> {
  return {
    store: new Map(),
    documentUpdates: new Map(),
    workspaceFolders,
    logger,
    connection,
    config: mergeConfig(config, defaultConfig),
  };
}

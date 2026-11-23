import type * as lsp from "vscode-languageserver";

import { type ProcessedDocumentStore } from "./DocumentProcessor";
import { type Config, mergeConfig, defaultConfig } from "./config";
import { DocumentConfigs } from "./documentConfigs";

export interface Context {
  store: ProcessedDocumentStore;
  /** Identifies the newest open/index operation for each document. */
  documentUpdates: Map<string, symbol>;
  scheduleSemanticTokensRefresh?: () => void;
  refreshDependentDiagnostics?: (
    uris: Iterable<string>,
    assemble?: boolean,
  ) => Promise<void>;
  workspaceFolders: lsp.WorkspaceFolder[];
  logger: lsp.Logger;
  connection: lsp.Connection;
  /**
   * The workspace's config: the client's settings, under the config file found
   * from the first workspace folder. For settings that must agree across every
   * file; how a document is assembled comes from `configFor`.
   */
  config: Config;
  /** Each document's own config file, found from its directory. */
  documentConfigs: DocumentConfigs;
}

export async function createContext(
  workspaceFolders: lsp.WorkspaceFolder[],
  logger: lsp.Logger,
  connection: lsp.Connection,
  config: Partial<Config>,
): Promise<Context> {
  const merged = mergeConfig(config, defaultConfig);
  return {
    store: new Map(),
    documentUpdates: new Map(),
    workspaceFolders,
    logger,
    connection,
    config: merged,
    documentConfigs: new DocumentConfigs(logger, merged),
  };
}

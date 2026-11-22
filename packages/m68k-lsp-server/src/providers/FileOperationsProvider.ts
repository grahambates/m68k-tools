import { IndexChangedNotification } from "@m68k-lsp/protocol";
import * as lsp from "vscode-languageserver";
import type { FileOperationFilter } from "vscode-languageserver-protocol/lib/common/protocol.fileOperations";
import { type Definition, type Symbols } from "../symbols";

import { type Provider } from ".";
import { type Context } from "../context";
import { configFileNames } from "@m68k-lsp/assembly-options";
import DocumentProcessor, { isProcessed } from "../DocumentProcessor";
import {
  getAsmFilesInDir,
  getEntryPoints,
  getIncluded,
  isAsmExt,
  isDir,
} from "../files";
import { isIndexExcluded } from "../workspace";
import { TextDocument } from "vscode-languageserver-textdocument";
import { includeRenameEdits, projectFileRenames } from "../includeRenames";

export default class FileOperationsProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  private fileDeletesMap: Map<string, Set<string>> = new Map();
  private versionedEdits = false;

  async onWillRenameFiles({
    files,
  }: lsp.RenameFilesParams): Promise<lsp.WorkspaceEdit | null> {
    const edits = await includeRenameEdits(files, this.ctx);
    if (!edits.length) return null;
    return this.versionedEdits
      ? { documentChanges: edits }
      : {
          changes: Object.fromEntries(
            edits.map(({ textDocument, edits }) => [textDocument.uri, edits]),
          ),
        };
  }

  async onWillDeleteFiles({ files }: lsp.DeleteFilesParams): Promise<null> {
    for (const { uri } of files) {
      let fileDeletes = this.fileDeletesMap.get(uri);
      if (!fileDeletes) {
        fileDeletes = new Set<string>();
        this.fileDeletesMap.set(uri, fileDeletes);
      }

      if (await isDir(uri)) {
        for (const childUri of await getAsmFilesInDir(uri)) {
          fileDeletes.add(childUri);
        }
      } else if (isAsmExt(uri)) {
        fileDeletes.add(uri);
      }
    }
    return null;
  }

  async onDidDeleteFiles({ files }: lsp.DeleteFilesParams): Promise<null> {
    const processor = new DocumentProcessor(this.ctx);
    for (const { uri } of files) {
      // didDelete may arrive without willDelete (for example from another client).
      const deleted = new Set([
        uri,
        ...(this.fileDeletesMap.get(uri) ?? []),
        ...Array.from(
          new Set([
            ...this.ctx.store.keys(),
            ...this.ctx.documentUpdates.keys(),
          ]),
        ).filter((key) => key.startsWith(uri.replace(/\/$/, "") + "/")),
      ]);
      for (const deleteUri of deleted) {
        processor.remove(deleteUri, false);
        if (!isProcessed(this.ctx.store.get(deleteUri))) {
          this.ctx.connection.sendDiagnostics({
            uri: deleteUri,
            diagnostics: [],
          });
        }
      }
      this.fileDeletesMap.delete(uri);
    }
    this.ctx.connection.sendNotification(IndexChangedNotification);
    return null;
  }

  async onDidCreateFiles({ files }: lsp.CreateFilesParams): Promise<null> {
    await this.onDidChangeWatchedFiles({
      changes: files.map(({ uri }) => ({
        uri,
        type: lsp.FileChangeType.Created,
      })),
    });
    return null;
  }

  async onDidChangeWatchedFiles({
    changes,
  }: lsp.DidChangeWatchedFilesParams): Promise<void> {
    if (changes.some(({ uri }) => isConfigFile(uri))) {
      this.ctx.documentConfigs.clear();
    }
    const processor = new DocumentProcessor(this.ctx);
    // Editors may report several events for one save; process the final state.
    const latest = new Map(changes.map((change) => [change.uri, change.type]));
    let changed = false;
    for (const [uri, type] of latest) {
      if (
        !this.ctx.store.has(uri) &&
        (!isAsmExt(uri) || isIndexExcluded(uri, this.ctx))
      ) {
        continue;
      }
      changed = true;
      if (type === lsp.FileChangeType.Deleted) {
        processor.remove(uri);
        if (!isProcessed(this.ctx.store.get(uri))) {
          this.ctx.connection.sendDiagnostics({ uri, diagnostics: [] });
        }
      } else {
        await processor.index(uri);
      }
    }
    if (changed) {
      await processor.settleIncludes();
      this.ctx.connection.sendNotification(IndexChangedNotification);
    }
  }

  async onDidRenameFiles({ files }: lsp.RenameFilesParams): Promise<null> {
    const renames = projectFileRenames(files);
    if (!renames) return null;
    this.ctx.documentConfigs.clear();
    const { moveUri } = renames;
    const moved = Array.from(this.ctx.store, ([oldUri, document]) => ({
      oldUri,
      newUri: moveUri(oldUri),
      document,
    })).filter(({ oldUri, newUri }) => oldUri !== newUri);
    for (const { oldUri } of moved) {
      this.ctx.documentUpdates.delete(oldUri);
      this.ctx.store.delete(oldUri);
    }
    for (const { oldUri, newUri, document } of moved) {
      this.ctx.logger.info(`renaming ${oldUri} to ${newUri}`);
      if (isProcessed(this.ctx.store.get(newUri))) continue;
      this.ctx.documentUpdates.set(newUri, Symbol());
      document.uri = newUri;
      relocateSymbols(document.symbols, newUri);
      if (isProcessed(document)) {
        const { languageId, version } = document.document;
        document.document = TextDocument.create(
          newUri,
          languageId,
          version,
          document.document.getText(),
        );
      }
      this.ctx.store.set(newUri, document);
    }

    // Refresh disk-backed includers after the client has applied the edits.
    const processor = new DocumentProcessor(this.ctx);
    const movedUris = new Set(moved.map(({ newUri }) => newUri));
    const reindex = new Set(movedUris);
    for (const document of this.ctx.store.values()) {
      const references = document.referencedUris.map(moveUri);
      if (
        references.some((uri, index) => uri !== document.referencedUris[index])
      ) {
        document.referencedUris = references;
        reindex.add(document.uri);
      }
    }
    for (const entry of getEntryPoints(this.ctx)) {
      if (!movedUris.has(entry)) continue;
      for (const included of getIncluded(entry, this.ctx))
        reindex.add(included);
    }
    if (!reindex.size) return null;
    await Promise.all(Array.from(reindex, (uri) => processor.index(uri)));
    await processor.settleIncludes();
    if (moved.length) this.ctx.scheduleSemanticTokensRefresh?.();
    return null;
  }

  register(
    connection: lsp.Connection,
    capabilities: lsp.ClientCapabilities = {},
  ): lsp.ServerCapabilities {
    this.versionedEdits =
      capabilities.workspace?.workspaceEdit?.documentChanges ?? false;
    connection.workspace.onWillRenameFiles(this.onWillRenameFiles.bind(this));
    connection.workspace.onWillDeleteFiles(this.onWillDeleteFiles.bind(this));
    connection.workspace.onDidDeleteFiles(this.onDidDeleteFiles.bind(this));
    connection.workspace.onDidRenameFiles(this.onDidRenameFiles.bind(this));
    connection.workspace.onDidCreateFiles(this.onDidCreateFiles.bind(this));
    connection.onDidChangeWatchedFiles(this.onDidChangeWatchedFiles.bind(this));

    const fileOperationFilter: FileOperationFilter = {
      pattern: {
        glob: "**/*.{s,i,asm}",
        options: { ignoreCase: true },
      },
    };

    const folderOperationFilter: FileOperationFilter = {
      pattern: {
        glob: "**/*",
      },
    };

    return {
      workspace: {
        fileOperations: {
          willRename: { filters: [folderOperationFilter] },
          willDelete: {
            filters: [fileOperationFilter, folderOperationFilter],
          },
          didDelete: {
            filters: [fileOperationFilter, folderOperationFilter],
          },
          didCreate: {
            filters: [fileOperationFilter],
          },
          didRename: {
            filters: [fileOperationFilter, folderOperationFilter],
          },
        },
      },
    };
  }
}

/** Symbol ranges stay valid across a rename, including unsaved editor text. */
function relocateSymbols(symbols: Symbols, uri: string): void {
  const relocateDefinition = (definition: Definition) => {
    definition.location.uri = uri;
    for (const local of definition.locals?.values() ?? []) {
      relocateDefinition(local);
    }
  };
  for (const definition of symbols.definitions.values()) {
    relocateDefinition(definition);
  }
  for (const references of symbols.references.values()) {
    for (const reference of references) {
      reference.location.uri = uri;
    }
  }
  for (const literal of [
    ...symbols.includes,
    ...symbols.incDirs,
    ...symbols.binaryIncludes,
  ]) {
    literal.location.uri = uri;
  }
}

/** Whether a file is a config file some document may go by. */
function isConfigFile(uri: string): boolean {
  const name = uri.slice(uri.lastIndexOf("/") + 1).toLowerCase();
  return (configFileNames as readonly string[]).includes(name);
}

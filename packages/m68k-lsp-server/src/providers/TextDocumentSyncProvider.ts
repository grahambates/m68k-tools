import { IndexChangedNotification } from "@m68k-lsp/protocol";
import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Provider } from ".";
import { type Context } from "../context";
import DiagnosticProcessor from "../diagnostics";
import DocumentProcessor, { isProcessed } from "../DocumentProcessor";

export default class TextDocumentSyncProvider implements Provider {
  private processor: DocumentProcessor;
  private diagnostics: DiagnosticProcessor;
  private connection: lsp.Connection;
  private diagnosticRuns = new Map<string, symbol>();

  constructor(protected readonly ctx: Context) {
    this.processor = new DocumentProcessor(ctx);
    this.diagnostics = new DiagnosticProcessor(ctx);
    this.connection = ctx.connection;
  }

  async onDidOpenTextDocument({
    textDocument: { uri, languageId, text, version },
  }: lsp.DidOpenTextDocumentParams) {
    const run = Symbol();
    this.diagnosticRuns.set(uri, run);
    try {
      const document = TextDocument.create(uri, languageId, version, text);
      const processed = await this.processor.process(document);
      if (
        this.diagnosticRuns.get(uri) === run &&
        this.ctx.store.get(uri) === processed
      ) {
        await this.fileDiagnostics(uri);
      }
    } catch (error) {
      this.ctx.logger.error(`Unable to process ${uri}: ${String(error)}`);
    }
  }

  async onDidChangeTextDocument({
    textDocument: { uri, version },
    contentChanges,
  }: lsp.DidChangeTextDocumentParams) {
    const run = Symbol();
    this.diagnosticRuns.set(uri, run);
    const existing = this.ctx.store.get(uri);
    if (!isProcessed(existing)) {
      return;
    }
    try {
      // Keep snapshots held by in-flight analysis immutable.
      const document = TextDocument.create(
        uri,
        existing.document.languageId,
        existing.document.version,
        existing.document.getText(),
      );
      const updatedDoc = TextDocument.update(document, contentChanges, version);
      const processed = await this.processor.process(updatedDoc);
      if (
        this.diagnosticRuns.get(uri) !== run ||
        this.ctx.store.get(uri) !== processed
      ) {
        return;
      }
      this.connection.sendDiagnostics({
        uri,
        version,
        diagnostics: this.diagnostics.parserDiagnostics(
          processed.parsed,
          processed.blocks,
        ),
      });
    } catch (error) {
      this.ctx.logger.error(`Unable to process ${uri}: ${String(error)}`);
    }
  }

  async onDidCloseTextDocument({
    textDocument: { uri },
  }: lsp.DidCloseTextDocumentParams) {
    this.diagnosticRuns.delete(uri);
    this.connection.sendDiagnostics({ uri, diagnostics: [] });
    try {
      await this.processor.close(uri);
      this.connection.sendNotification(IndexChangedNotification);
    } catch (error) {
      this.ctx.logger.error(
        `Unable to index closed document ${uri}: ${String(error)}`,
      );
    }
  }

  async onDidSaveTextDocument({
    textDocument: { uri },
  }: lsp.DidSaveTextDocumentParams) {
    await this.fileDiagnostics(uri);
  }

  /** Publish only the latest diagnostics for the same open document snapshot. */
  async fileDiagnostics(uri: string) {
    const existing = this.ctx.store.get(uri);
    if (!isProcessed(existing)) {
      return;
    }
    const version = existing.document.version;
    const run = Symbol();
    this.diagnosticRuns.set(uri, run);
    try {
      const vasmDiagnostics = await this.diagnostics.vasmDiagnostics(uri);
      if (
        this.diagnosticRuns.get(uri) !== run ||
        this.ctx.store.get(uri) !== existing ||
        existing.document.version !== version
      ) {
        return;
      }
      this.connection.sendDiagnostics({
        uri,
        version,
        diagnostics: [
          ...this.diagnostics.parserDiagnostics(
            existing.parsed,
            existing.blocks,
          ),
          ...vasmDiagnostics,
        ],
      });
    } catch (error) {
      this.ctx.logger.error(`Unable to diagnose ${uri}: ${String(error)}`);
    }
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onDidOpenTextDocument(this.onDidOpenTextDocument.bind(this));
    connection.onDidChangeTextDocument(this.onDidChangeTextDocument.bind(this));
    connection.onDidSaveTextDocument(this.onDidSaveTextDocument.bind(this));
    connection.onDidCloseTextDocument(this.onDidCloseTextDocument.bind(this));
    return {
      textDocumentSync: {
        openClose: true,
        change: lsp.TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
    };
  }
}

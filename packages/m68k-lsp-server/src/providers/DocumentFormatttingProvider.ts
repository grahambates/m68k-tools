import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type * as lsp from "vscode-languageserver";
import { type Provider } from ".";
import { type Context } from "../context";
import {
  DocumentFormatter,
  findConfig,
  loadConfig,
  mergeOptions,
  type FormatContext,
} from "m68k-formatter";
import { isProcessed, type ProcessedDocument } from "../DocumentProcessor";

export default class DocumentFormattingProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onDocumentFormatting({
    textDocument,
    options,
  }: lsp.DocumentFormattingParams): Promise<lsp.TextEdit[] | null> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return null;
    }
    const formatter = await this.getFormatter(options, textDocument.uri);
    return formatter.format(toContext(processed));
  }

  async onDocumentRangeFormatting({
    textDocument,
    options,
    range,
  }: lsp.DocumentRangeFormattingParams): Promise<lsp.TextEdit[] | null> {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return null;
    }
    const formatter = await this.getFormatter(options, textDocument.uri);
    return formatter.formatRange(toContext(processed), range);
  }

  async onDocumentOnTypeFormatting({
    textDocument,
    options,
    position,
    ch,
  }: lsp.DocumentOnTypeFormattingParams) {
    const processed = this.ctx.store.get(textDocument.uri);
    if (!isProcessed(processed)) {
      return null;
    }
    const formatter = await this.getFormatter(
      {
        ...options,
        // Force trim whitespace off while still typing
        trimTrailingWhitespace: false,
      },
      textDocument.uri,
    );
    // Line to format - current or previous if NL
    const line = ch === "\n" ? position.line - 1 : position.line;
    const range = {
      start: { line, character: 0 },
      end: { line: line + 1, character: 0 },
    };
    return formatter.formatRange(toContext(processed), range);
  }

  private async getFormatter(
    options: lsp.FormattingOptions,
    uri: string,
  ): Promise<DocumentFormatter> {
    // Defaults
    const path = uri.startsWith("file:")
      ? await findConfig(dirname(fileURLToPath(uri)))
      : undefined;
    const config = mergeOptions(
      this.ctx.config.format,
      path ? await loadConfig(path) : {},
    );

    // Override defaults with passed options
    if (options.trimFinalNewlines) {
      config.finalNewLine = false;
    }
    if (options.insertFinalNewline) {
      config.finalNewLine = true;
    }
    if (options.trimTrailingWhitespace !== undefined) {
      config.trimWhitespace = options.trimTrailingWhitespace;
    }
    if (!config.align) {
      config.align = {};
    }
    if (options.insertSpaces !== undefined) {
      config.align.indentStyle = options.insertSpaces ? "space" : "tab";
    }
    if (options.tabSize !== undefined) {
      config.align.tabSize = options.tabSize;
    }

    return new DocumentFormatter(config);
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onDocumentFormatting(this.onDocumentFormatting.bind(this));
    connection.onDocumentRangeFormatting(
      this.onDocumentRangeFormatting.bind(this),
    );
    connection.onDocumentOnTypeFormatting(
      this.onDocumentOnTypeFormatting.bind(this),
    );
    return {
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      documentOnTypeFormattingProvider: {
        firstTriggerCharacter: "\n",
        moreTriggerCharacter: [";", " ", "\t", ",", "."],
      },
    };
  }
}

function toContext(processed: ProcessedDocument): FormatContext {
  return { parsed: processed.parsed, text: processed.document.getText() };
}

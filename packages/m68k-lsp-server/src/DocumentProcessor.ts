import {
  collectMacroDefinitions as collectDefinitions,
  parseBlocks,
  parseFile,
} from "m68k-parser";
import type { BlockStructure, MacroDefinition, ParsedFile } from "m68k-parser";
import { type TextDocument } from "vscode-languageserver-textdocument";

import { readDocumentFromUri, resolveReferencedUris } from "./files";
import { processSymbols, type Symbols } from "./symbols";
import { type Context } from "./context";

/**
 * What every file in the workspace contributes to resolution.
 *
 * Symbols and include edges are all that cross file boundaries, and they are
 * cheap to keep: a thousand files cost a few megabytes this way, against a
 * couple of hundred for their syntax trees.
 */
export interface IndexedDocument {
  uri: string;
  symbols: Symbols;
  referencedUris: string[];
  macros: Map<string, MacroDefinition>;
}

/**
 * An open document, with the syntax tree kept alongside its symbols.
 *
 * Everything that needs the tree - formatting, folding, hover, completion -
 * works on the document the request names, which is open by definition.
 */
export interface ProcessedDocument extends IndexedDocument {
  document: TextDocument;
  parsed: ParsedFile;
  /** Macro, repeat and conditional nesting derived from `parsed`. */
  blocks: BlockStructure;
}

export type DocumentStore = Map<string, IndexedDocument>;

/** Backwards-compatible alias for the store type. */
export type ProcessedDocumentStore = DocumentStore;

export function isProcessed(
  doc: IndexedDocument | undefined,
): doc is ProcessedDocument {
  return doc !== undefined && "parsed" in doc;
}

// Shared across processor instances, without retaining closed document objects.
const referenceUpdates = new WeakMap<IndexedDocument, symbol>();

export default class DocumentProcessor {
  constructor(protected readonly ctx: Context) {}

  /**
   * Process an open document, keeping its syntax tree.
   *
   * Files it includes are indexed rather than processed: they are needed for
   * resolution, not for editing, until one of them is opened in its own right.
   */
  async process(document: TextDocument): Promise<ProcessedDocument> {
    this.ctx.logger.log("processDocument: " + document.uri);
    const update = Symbol();
    this.ctx.documentUpdates.set(document.uri, update);

    const text = document.getText();
    const parsed = parseFile(text);
    const blocks = parseBlocks(parsed);

    const processed: ProcessedDocument = {
      uri: document.uri,
      document,
      parsed,
      blocks,
      symbols: processSymbols(document.uri, parsed, blocks, text),
      referencedUris: [],
      macros: collectMacroDefinitions(parsed, blocks, text),
    };

    this.ctx.store.set(document.uri, processed);

    await this.resolveReferences(processed, update);

    return processed;
  }

  /**
   * Read and index a file, keeping only what resolution needs.
   *
   * Returns the existing entry when the file is already open, so indexing
   * never discards a syntax tree that something is using.
   */
  async index(uri: string): Promise<IndexedDocument | undefined> {
    const existing = this.ctx.store.get(uri);
    if (isProcessed(existing)) {
      return existing;
    }

    const update = Symbol();
    this.ctx.documentUpdates.set(uri, update);
    const document = await readDocumentFromUri(uri);
    // A later open, close, disk change or deletion wins over this disk read.
    if (this.ctx.documentUpdates.get(uri) !== update) {
      return this.ctx.store.get(uri);
    }
    if (!document) {
      this.remove(uri);
      return undefined;
    }

    const text = document.getText();
    const parsed = parseFile(text);
    const blocks = parseBlocks(parsed);

    const indexed: IndexedDocument = {
      uri,
      symbols: processSymbols(uri, parsed, blocks, text),
      referencedUris: [],
      macros: collectMacroDefinitions(parsed, blocks, text),
    };

    this.ctx.store.set(uri, indexed);

    await this.resolveReferences(indexed, update);
    return indexed;
  }

  /** Release editor text immediately, then rebuild symbols from the saved file. */
  async close(uri: string): Promise<void> {
    this.ctx.documentUpdates.delete(uri);
    this.ctx.store.delete(uri);
    await this.index(uri);
  }

  /** Remove disk-backed data; an open editor remains authoritative. */
  remove(uri: string, preserveOpen = true): void {
    if (preserveOpen && isProcessed(this.ctx.store.get(uri))) {
      return;
    }
    this.ctx.documentUpdates.delete(uri);
    this.ctx.store.delete(uri);
    for (const document of this.ctx.store.values()) {
      referenceUpdates.delete(document);
      document.referencedUris = document.referencedUris.filter(
        (ref) => ref !== uri,
      );
    }
  }

  /** Reconnect includes after files appear, disappear, or change their incdirs. */
  async refreshIncludes(): Promise<void> {
    for (const document of Array.from(this.ctx.store.values())) {
      if (document.symbols.includes.length) {
        await this.resolveReferences(
          document,
          this.ctx.documentUpdates.get(document.uri),
        );
      }
    }
  }

  private async resolveReferences(
    document: IndexedDocument,
    update: symbol | undefined,
  ): Promise<void> {
    const referenceUpdate = Symbol();
    referenceUpdates.set(document, referenceUpdate);
    const resolved = await resolveReferencedUris(document.uri, this.ctx);
    if (
      referenceUpdates.get(document) !== referenceUpdate ||
      this.ctx.store.get(document.uri) !== document ||
      this.ctx.documentUpdates.get(document.uri) !== update
    ) {
      return;
    }
    document.referencedUris = resolved;
    await Promise.all(resolved.map((uri) => this.indexIfAbsent(uri)));
  }

  /** Index a file and everything it includes, skipping what is already known. */
  private async indexIfAbsent(uri: string): Promise<void> {
    if (this.ctx.store.has(uri)) {
      return;
    }
    await this.index(uri);
  }
}

/** Definitions by lower-cased name; where a name is defined twice, the later wins. */
function collectMacroDefinitions(
  parsed: ParsedFile,
  blocks: BlockStructure,
  text: string,
): Map<string, MacroDefinition> {
  const definitions = new Map<string, MacroDefinition>();
  for (const definition of collectDefinitions(
    parsed,
    text.split(/\r?\n/g),
    blocks,
  ))
    definitions.set(definition.name.toLowerCase(), definition);
  return definitions;
}

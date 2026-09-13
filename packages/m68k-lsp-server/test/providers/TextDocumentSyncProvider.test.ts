import type * as lsp from "vscode-languageserver";

import { type Context } from "../../src/context";
import TextDocumentSyncProvider from "../../src/providers/TextDocumentSyncProvider";
import { createTestContext, range } from "../helpers";
import type {
  IndexedDocument,
  ProcessedDocument,
} from "../../src/DocumentProcessor";

/** Open documents keep their text; these tests always look at one of those. */
const asProcessed = (doc: IndexedDocument | undefined) =>
  doc as ProcessedDocument;

describe("TextDocumentSyncProvider", () => {
  let provider: TextDocumentSyncProvider;
  let ctx: Context;

  beforeAll(async () => {
    ctx = await createTestContext();
    provider = new TextDocumentSyncProvider(ctx);
  });

  describe("#register()", () => {
    it("regsiters", () => {
      const conn = {
        onDidOpenTextDocument: vi.fn(),
        onDidChangeTextDocument: vi.fn(),
        onDidSaveTextDocument: vi.fn(),
        onDidCloseTextDocument: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onDidOpenTextDocument).toHaveBeenCalled();
      expect(conn.onDidChangeTextDocument).toHaveBeenCalled();
      expect(conn.onDidCloseTextDocument).toHaveBeenCalled();
      expect(capabilities.textDocumentSync).toMatchObject({
        openClose: true,
        save: { includeText: false },
      });
      expect(capabilities).toHaveProperty("textDocumentSync");
    });
  });

  describe("#onDidOpenTextDocument()", () => {
    it("processes a new document", async () => {
      const uri = "file:///example.s";
      await provider.onDidOpenTextDocument({
        textDocument: {
          uri,
          languageId: "vasmmot",
          version: 1,
          text: " move d0,d1",
        },
      });

      const processed = ctx.store.get(uri);
      expect(processed).toBeTruthy();
      expect(asProcessed(processed).document.getText()).toBe(" move d0,d1");
    });
  });

  describe("#onDidChangeTextDocument()", () => {
    it("processes a change", async () => {
      const uri = "file:///example.s";
      await provider.onDidOpenTextDocument({
        textDocument: {
          uri,
          languageId: "vasmmot",
          version: 1,
          text: " move d0,d1",
        },
      });

      await provider.onDidChangeTextDocument({
        textDocument: {
          uri,
          version: 2,
        },
        contentChanges: [{ range: range(0, 7, 0, 8), text: "2" }],
      });

      const processed = ctx.store.get(uri);
      expect(asProcessed(processed).document.getText()).toBe(" move d2,d1");
    });
  });
});

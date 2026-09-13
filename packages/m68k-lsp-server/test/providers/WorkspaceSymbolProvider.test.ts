import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import WorkspaceSymbolProvider from "../../src/providers/WorkspaceSymbolProvider";
import { createTestContext, range } from "../helpers";

describe("WorkspaceSymbolProvider", () => {
  let provider: WorkspaceSymbolProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new WorkspaceSymbolProvider(ctx);
  });

  // Create and process text doc
  const createDoc = async (filename: string, text: string) => {
    const uri = ctx.workspaceFolders[0].uri + "/" + filename;
    const textDocument = TextDocument.create(uri, "vasmmot", 0, text);
    await processor.process(textDocument);
    return textDocument;
  };

  describe("#register()", () => {
    it("regsiters", () => {
      const conn = {
        onWorkspaceSymbol: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onWorkspaceSymbol).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("workspaceSymbolProvider");
    });
  });

  describe("#onWorkspaceSymbol()", () => {
    it("lists symbols from all documents", async () => {
      const textDocument1 = await createDoc("example.s", `foo1 = 2`);
      const textDocument2 = await createDoc("example2.s", `foo2 = 2`);

      const symbols = await provider.onWorkspaceSymbol({
        query: "f",
      });

      expect(symbols).toHaveLength(2);
      expect(symbols).toContainEqual({
        name: "foo1",
        kind: lsp.SymbolKind.Constant,
        location: {
          uri: textDocument1.uri,
          range: range(0, 0, 0, 8),
        },
      });
      expect(symbols).toContainEqual({
        name: "foo2",
        kind: lsp.SymbolKind.Constant,
        location: {
          uri: textDocument2.uri,
          range: range(0, 0, 0, 8),
        },
      });
    });
  });
});

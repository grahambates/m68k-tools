import type * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import DocumentLinkProvider from "../../src/providers/DocumentLinkProvider";
import { createTestContext } from "../helpers";

describe("DocumentLinkProvider", () => {
  let provider: DocumentLinkProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new DocumentLinkProvider(ctx);
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
        onDocumentLinks: vi.fn(),
        onDocumentLinkResolve: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onDocumentLinks).toHaveBeenCalled();
      expect(conn.onDocumentLinkResolve).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("documentLinkProvider");
    });
  });

  describe("#onDocumentLinks()", () => {
    it("links to an include", async () => {
      const textDocument = await createDoc(
        "example.s",
        ` include example.i
 move #foo,d0`,
      );

      const links = await provider.onDocumentLinks({
        textDocument,
      });

      expect(links).toHaveLength(1);
      expect(links![0].range).toEqual({
        start: {
          line: 0,
          character: 9,
        },
        end: {
          line: 0,
          character: 18,
        },
      });
      expect(links![0].data.path).toEqual("example.i");
    });
  });

  describe("#onDocumentLinkResolve()", () => {
    it("resolved the link target", async () => {
      const link: lsp.DocumentLink = {
        range: {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 18 },
        },
        data: {
          path: "example.i",
          uri: ctx.workspaceFolders[0].uri + "/example.s",
        },
      };
      const updated = await provider.onDocumentLinkResolve(link);

      expect(updated.target).toMatch(/\/test\/fixtures\/example\.i/);
    });
  });
});

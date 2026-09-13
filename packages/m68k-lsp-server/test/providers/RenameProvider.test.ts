import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import RenameProvider from "../../src/providers/RenameProvider";
import { createTestContext, range } from "../helpers";

describe("RenameProvider", () => {
  let provider: RenameProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new RenameProvider(ctx);
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
        onPrepareRename: vi.fn(),
        onRenameRequest: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onPrepareRename).toHaveBeenCalled();
      expect(conn.onRenameRequest).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("renameProvider");
    });
  });

  describe("#onPrepareRename()", () => {
    it("renames a definition", async () => {
      const textDocument = await createDoc("example.s", `foo = 123`);

      const renameRange = await provider.onPrepareRename({
        position: lsp.Position.create(0, 1),
        textDocument,
      });

      expect(renameRange).toEqual(range(0, 0, 0, 3));
    });

    it("renames a reference", async () => {
      const textDocument = await createDoc("example.s", ` move foo,d0`);

      const renameRange = await provider.onPrepareRename({
        position: lsp.Position.create(0, 8),
        textDocument,
      });

      expect(renameRange).toEqual(range(0, 6, 0, 9));
    });
  });

  describe("#onRenameRequest()", () => {
    it("renames symbols for a definition in same doc", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123
 move foo,d0
 move #foo,d1`,
      );

      const newText = "example";

      const op = await provider.onRenameRequest({
        position: lsp.Position.create(0, 1),
        textDocument,
        newName: newText,
      });
      const changes = op.changes![textDocument.uri];

      expect(changes).toContainEqual({
        newText,
        range: range(0, 0, 0, 3),
      });
      expect(changes).toContainEqual({
        newText,
        range: range(1, 6, 1, 9),
      });
      expect(changes).toContainEqual({
        newText,
        range: range(2, 7, 2, 10),
      });
    });

    it("renames symbols for a reference in same doc", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123
 move foo,d0
 move #foo,d1`,
      );

      const newText = "example";

      const op = await provider.onRenameRequest({
        position: lsp.Position.create(1, 8),
        textDocument,
        newName: newText,
      });
      const changes = op.changes![textDocument.uri];

      expect(changes).toContainEqual({
        newText,
        range: range(0, 0, 0, 3),
      });
      expect(changes).toContainEqual({
        newText,
        range: range(1, 6, 1, 9),
      });
      expect(changes).toContainEqual({
        newText,
        range: range(2, 7, 2, 10),
      });
    });

    it("renames symbols across multiple docs", async () => {
      const textDocument = await createDoc(
        "example.s",
        ` include 'example.i'
 move foo,d0
 move #foo,d1`,
      );

      const newText = "example";

      const op = await provider.onRenameRequest({
        position: lsp.Position.create(1, 8),
        textDocument,
        newName: newText,
      });

      const currentDocChanges = op.changes![textDocument.uri];
      expect(currentDocChanges).toContainEqual({
        newText,
        range: range(1, 6, 1, 9),
      });
      expect(currentDocChanges).toContainEqual({
        newText,
        range: range(2, 7, 2, 10),
      });

      const includedDocChanges =
        op.changes![ctx.workspaceFolders[0].uri + "/example.i"];
      expect(includedDocChanges).toContainEqual({
        newText,
        range: range(1, 0, 1, 3),
      });
    });
  });
});

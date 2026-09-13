import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import DocumentHighlightProvider from "../../src/providers/DocumentHighlightProvider";
import { createTestContext, range } from "../helpers";

describe("DocumentHighlightProvider", () => {
  let provider: DocumentHighlightProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new DocumentHighlightProvider(ctx);
  });

  // Create and process text doc
  const createDoc = async (filename: string, text: string) => {
    const uri = ctx.workspaceFolders[0].uri + "/" + filename;
    const textDocument = TextDocument.create(uri, "vasmmot", 0, text);
    await processor.process(textDocument);
    return textDocument;
  };

  describe("#register()", () => {
    it("registers document highlighting", () => {
      const conn = { onDocumentHighlight: vi.fn() };
      expect(provider.register(conn as unknown as lsp.Connection)).toEqual({
        documentHighlightProvider: true,
      });
      expect(conn.onDocumentHighlight).toHaveBeenCalled();
    });
  });

  describe("#onDocumentHighlight()", () => {
    it("highlights definition from usage", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123
 move #foo,d0`,
      );

      const hightlights = await provider.onDocumentHighlight({
        position: lsp.Position.create(1, 8),
        textDocument,
      });

      expect(hightlights).toHaveLength(2);
      expect(hightlights![0].range).toEqual(range(1, 7, 1, 10));
      expect(hightlights![1].range).toEqual(range(0, 0, 0, 3));
    });
  });

  it("highlights usage from definition", async () => {
    const textDocument = await createDoc(
      "example.s",
      `foo = 123
 move #foo,d0`,
    );

    const hightlights = await provider.onDocumentHighlight({
      position: lsp.Position.create(0, 2),
      textDocument,
    });

    expect(hightlights).toHaveLength(2);
    expect(hightlights![0].range).toEqual(range(1, 7, 1, 10));
    expect(hightlights![1].range).toEqual(range(0, 0, 0, 3));
  });

  it("returns no highlights if not in word", async () => {
    const textDocument = await createDoc("example123.s", ` move #foo,d0`);

    const hightlights = await provider.onDocumentHighlight({
      position: lsp.Position.create(1, 5),
      textDocument,
    });

    expect(hightlights).toHaveLength(0);
  });

  it("highlights numbered and named registers", async () => {
    const textDocument = await createDoc(
      "registers.s",
      ` move d0,(a0,d0.w)
 move D0,d1
 move sr,CCR
 fmove fp0,fpcr
`,
    );

    const cases = [
      { position: [0, 7], length: 3 },
      { position: [0, 11], length: 1 },
      { position: [0, 14], length: 3 },
      { position: [2, 7], length: 1 },
      { position: [2, 11], length: 1 },
      { position: [3, 8], length: 1 },
      { position: [3, 12], length: 1 },
    ];

    for (const { position, length } of cases) {
      const highlights = await provider.onDocumentHighlight({
        position: lsp.Position.create(position[0], position[1]),
        textDocument,
      });

      expect(highlights).toHaveLength(length);
    }
  });
});

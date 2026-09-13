import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import DocumentSymbolProvider from "../../src/providers/DocumentSymbolProvider";
import { createTestContext, range } from "../helpers";

describe("DocumentSymbolProvider", () => {
  let provider: DocumentSymbolProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new DocumentSymbolProvider(ctx);
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
        onDocumentSymbol: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onDocumentSymbol).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("documentSymbolProvider");
    });
  });

  describe("#onDocumentSymbol()", () => {
    it("lists constants", async () => {
      const textDocument = await createDoc("example.s", `foo = 1`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Constant);
      expect(symbols[0].range).toEqual(range(0, 0, 0, 7));
      expect(symbols[0].selectionRange).toEqual(range(0, 0, 0, 3));
    });

    it("lists variables", async () => {
      const textDocument = await createDoc("example.s", `foo SET 1`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Variable);
      expect(symbols[0].range).toEqual(range(0, 0, 0, 9));
      expect(symbols[0].selectionRange).toEqual(range(0, 0, 0, 3));
    });

    it("lists labels", async () => {
      const textDocument = await createDoc("example.s", `foo:`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Field);
      expect(symbols[0].range).toEqual(range(0, 0, 0, 4));
      expect(symbols[0].selectionRange).toEqual(range(0, 0, 0, 3));
    });

    it("lists local labels as children", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo:
.bar:`,
      );

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].children).toHaveLength(1);

      const child = symbols[0].children![0];
      expect(child.name).toBe(".bar");
      //       expect(child.detail).toBe("label");
      expect(child.kind).toBe(lsp.SymbolKind.Field);
      expect(child.range).toEqual(range(1, 0, 1, 5));
      expect(child.selectionRange).toEqual(range(1, 0, 1, 4));
    });

    it("lists offsets", async () => {
      const textDocument = await createDoc("example.s", `foo rs.w 1`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].detail).toBe("offset");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Constant);
      expect(symbols[0].range).toEqual(range(0, 0, 0, 10));
      expect(symbols[0].selectionRange).toEqual(range(0, 0, 0, 3));
    });

    it("lists registers", async () => {
      const textDocument = await createDoc("example.s", `foo equr d0`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].detail).toBe("register");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Constant);
      expect(symbols[0].range).toEqual(range(0, 0, 0, 11));
      expect(symbols[0].selectionRange).toEqual(range(0, 0, 0, 3));
    });

    it("lists register lists", async () => {
      const textDocument = await createDoc("example.s", `foo equrl d0-d6`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].detail).toBe("register list");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Constant);
      expect(symbols[0].range).toEqual(range(0, 0, 0, 15));
      expect(symbols[0].selectionRange).toEqual(range(0, 0, 0, 3));
    });

    it("lists sections", async () => {
      const textDocument = await createDoc("example.s", ` section foo,bss`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Module);
      expect(symbols[0].range).toEqual(range(0, 1, 0, 16));
      expect(symbols[0].selectionRange).toEqual(range(0, 9, 0, 12));
    });

    it("lists macros", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo macro
      move d0,d1
      endm`,
      );

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].detail).toBe("macro");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Function);
      expect(symbols[0].range).toEqual(range(0, 0, 2, 10));
      expect(symbols[0].selectionRange).toEqual(range(0, 0, 0, 3));
    });

    it("lists xrefs", async () => {
      const textDocument = await createDoc("example.s", ` xref foo`);

      const symbols = await provider.onDocumentSymbol({
        textDocument,
      });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe("foo");
      expect(symbols[0].detail).toBe("external");
      expect(symbols[0].kind).toBe(lsp.SymbolKind.Field);
      expect(symbols[0].range).toEqual(range(0, 1, 0, 9));
      expect(symbols[0].selectionRange).toEqual(range(0, 6, 0, 9));
    });

    it("omits labels whose names are macro templates", async () => {
      const textDocument = await createDoc(
        "example.s",
        `Real:
MyMacro macro
.loop\\@:
\tdbf d0,.loop\\@
BLTEN_\\1:
\tendm`,
      );

      const symbols = await provider.onDocumentSymbol({ textDocument });
      const names = symbols.map((s) => s.name);

      // `.loop\@` and `BLTEN_\1` resolve per expansion, so they are not
      // definitions in their own right.
      expect(names).toContain("Real");
      expect(names).toContain("MyMacro");
      expect(names.join(",")).not.toContain("\\");
    });
  });
});

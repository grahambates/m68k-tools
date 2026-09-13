import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import ReferencesProvider from "../../src/providers/ReferencesProvider";
import { createTestContext, range } from "../helpers";

describe("ReferencesProvider", () => {
  let provider: ReferencesProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new ReferencesProvider(ctx);
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
        onReferences: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onReferences).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("referencesProvider");
    });
  });

  describe("#onReferences()", () => {
    it("returns references for a definition in same doc", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123
 move foo,d0
 move #foo,d1`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(0, 1),
        textDocument,
        context: { includeDeclaration: true },
      });

      expect(references).toHaveLength(3);

      // Definition
      expect(references).toContainEqual({
        uri: textDocument.uri,
        range: range(0, 0, 0, 9),
      });
      // Usage 1:
      expect(references).toContainEqual({
        uri: textDocument.uri,
        range: range(1, 6, 1, 9),
      });
      // Usage 2:
      expect(references).toContainEqual({
        uri: textDocument.uri,
        range: range(2, 7, 2, 10),
      });
    });

    it("returns references for a local definition", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo:
.bar
 dbf d0,.bar
baz:`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(1, 2),
        textDocument,
        context: { includeDeclaration: true },
      });

      expect(references).toHaveLength(2);

      // Definition
      expect(references).toContainEqual({
        uri: textDocument.uri,
        range: range(1, 0, 1, 4),
      });
      // Usage 1
      expect(references).toContainEqual({
        uri: textDocument.uri,
        range: range(2, 8, 2, 12),
      });
    });

    it("returns references for a usage in same doc", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123
 move foo,d0
 move #foo,d1`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(1, 7),
        textDocument,
        context: { includeDeclaration: true },
      });

      expect(references).toHaveLength(3);
    });

    it("returns a definition in an included doc", async () => {
      const textDocument = await createDoc(
        "example.s",
        ` include "example.i"
 move #foo,d1`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(1, 7),
        textDocument,
        context: { includeDeclaration: true },
      });

      expect(references).toHaveLength(2);

      // Definition
      expect(references).toContainEqual({
        uri: expect.stringContaining("example.i"),
        range: range(1, 0, 1, 9),
      });
      // Usage:
      expect(references).toContainEqual({
        uri: textDocument.uri,
        range: range(1, 7, 1, 10),
      });
    });

    it("returns a reference in an included doc", async () => {
      const textDocument = await createDoc(
        "example.s",
        ` include "example.i"
bar = 123`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(1, 2),
        textDocument,
        context: { includeDeclaration: true },
      });

      expect(references).toHaveLength(2);

      // Definition
      expect(references).toContainEqual({
        uri: textDocument.uri,
        range: range(1, 0, 1, 9),
      });
      // Usage:
      expect(references).toContainEqual({
        uri: expect.stringContaining("example.i"),
        range: range(2, 7, 2, 10),
      });
    });

    it("it excludes definition if includeDeclaration = false", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123
 move foo,d0
 move #foo,d1`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(0, 1),
        textDocument,
        context: { includeDeclaration: false },
      });

      expect(references).toHaveLength(2);
    });

    it("does not cross into a sibling that shares an include", async () => {
      // Two entry points, each defining `shared`, both including example.i.
      // They are separate assembly units, so neither can see the other.
      await createDoc(
        "unitB.s",
        ` include "example.i"
shared:
 bsr shared`,
      );
      const unitA = await createDoc(
        "unitA.s",
        ` include "example.i"
shared:
 bsr shared`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(1, 2),
        textDocument: unitA,
        context: { includeDeclaration: true },
      });

      expect(references.every((r) => r.uri === unitA.uri)).toBe(true);
      expect(references).toHaveLength(2);
    });

    it("spans every unit that includes the defining file", async () => {
      // `foo` is defined in example.i, which both units include, so a use in
      // either is a reference to it.
      const unitA = await createDoc(
        "incA.s",
        ` include "example.i"
 move #foo,d0`,
      );
      await createDoc(
        "incB.s",
        ` include "example.i"
 move #foo,d1`,
      );

      const references = await provider.onReferences({
        position: lsp.Position.create(1, 8),
        textDocument: unitA,
        context: { includeDeclaration: false },
      });

      const uris = new Set(references.map((r) => r.uri));
      expect([...uris].some((u) => u.endsWith("incA.s"))).toBe(true);
      expect([...uris].some((u) => u.endsWith("incB.s"))).toBe(true);
    });
  });
});

import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import DefinitionProvider from "../../src/providers/DefinitionProvider";
import { createTestContext, range } from "../helpers";

describe("DefinitionProvider", () => {
  let provider: DefinitionProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new DefinitionProvider(ctx);
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
        onDefinition: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onDefinition).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("definitionProvider");
    });
  });

  describe("#onDefinition()", () => {
    it("returns a constant definition in same doc", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123
 move #foo,d0`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(1, 8),
        textDocument,
      });

      expect(definitions).toHaveLength(1);
      expect(definitions[0].uri).toBe(textDocument.uri);
      expect(definitions[0].range).toEqual(range(0, 0, 0, 9));
    });

    it("returns a definition for a local label", async () => {
      const textDocument = await createDoc(
        "example.s",
        `global:
.local:
 bra .local`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(2, 8),
        textDocument,
      });

      expect(definitions).toHaveLength(1);
      expect(definitions[0].uri).toBe(textDocument.uri);
      expect(definitions[0].range).toEqual(range(1, 0, 1, 7));
    });

    it("returns a contant definition in included doc", async () => {
      const textDocument = await createDoc(
        "example123.s",
        ` include example.i
 move #foo,d0`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(1, 8),
        textDocument,
      });

      expect(definitions).toHaveLength(1);
      expect(definitions[0].uri).toMatch(/example.i/);
      expect(definitions[0].range).toEqual(range(1, 0, 1, 9));
    });

    it("returns no definition if not in word", async () => {
      const textDocument = await createDoc("example123.s", ` move #foo,d0`);

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(1, 5),
        textDocument,
      });

      expect(definitions).toHaveLength(0);
    });

    it("returns the last move to a register", async () => {
      const textDocument = await createDoc(
        "register-definition.s",
        `Start:
 moveq #1,d0
 moveq #2,d0
 add.w d1,d0
 move.w d0,d2
`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(4, 8),
        textDocument,
      });

      expect(definitions).toEqual([
        { uri: textDocument.uri, range: range(2, 10, 2, 12) },
      ]);
    });

    it("crosses local labels when finding a register assignment", async () => {
      const textDocument = await createDoc(
        "local-register-definition.s",
        `Start:
 lea table,a0
.loop:
 move.w (a0),d0
`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(3, 10),
        textDocument,
      });

      expect(definitions).toEqual([
        { uri: textDocument.uri, range: range(1, 11, 1, 13) },
      ]);
    });

    it("does not cross a non-local label", async () => {
      const textDocument = await createDoc(
        "scoped-register-definition.s",
        `First:
 moveq #1,d0
Second:
 add.w d1,d0
 move.w d0,d2
`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(4, 8),
        textDocument,
      });

      expect(definitions).toEqual([]);
    });

    it("finds an assignment on the boundary label line", async () => {
      const textDocument = await createDoc(
        "inline-register-definition.s",
        `First: moveq #1,d0
 move.w d0,d1
`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(1, 8),
        textDocument,
      });

      expect(definitions).toEqual([
        { uri: textDocument.uri, range: range(0, 16, 0, 18) },
      ]);
    });

    it("normalises SP to A7", async () => {
      const textDocument = await createDoc(
        "stack-register-definition.s",
        `Start:
 lea stack,sp
 move.l a7,d0
`,
      );

      const definitions = await provider.onDefinition({
        position: lsp.Position.create(2, 8),
        textDocument,
      });

      expect(definitions).toEqual([
        { uri: textDocument.uri, range: range(1, 11, 1, 13) },
      ]);
    });
  });
});

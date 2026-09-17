import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import InlayHintProvider from "../../src/providers/InlayHintProvider";
import { createTestContext, range } from "../helpers";

describe("InlayHintProvider", () => {
  let provider: InlayHintProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext({ inlayHints: { enabled: true } });
    processor = new DocumentProcessor(ctx);
    provider = new InlayHintProvider(ctx);
  });

  // Create and process text doc
  const createDoc = async (filename: string, text: string) => {
    const uri = ctx.workspaceFolders[0].uri + "/" + filename;
    const textDocument = TextDocument.create(uri, "vasmmot", 0, text);
    await processor.process(textDocument);
    return textDocument;
  };

  const wholeFile = range(0, 0, 1000, 0);

  describe("#register()", () => {
    it("registers", () => {
      const conn = {
        languages: { inlayHint: { on: vi.fn() } },
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.languages.inlayHint.on).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("inlayHintProvider");
    });
  });

  describe("#onInlayHint()", () => {
    it("is enabled by default", async () => {
      const defaultCtx = await createTestContext();
      const defaultProcessor = new DocumentProcessor(defaultCtx);
      const defaultProvider = new InlayHintProvider(defaultCtx);
      const uri = defaultCtx.workspaceFolders[0].uri + "/default.s";
      const textDocument = TextDocument.create(uri, "vasmmot", 0, "A equ 1+2");
      await defaultProcessor.process(textDocument);

      const hints = await defaultProvider.onInlayHint({
        textDocument,
        range: wholeFile,
      });

      expect(hints).toHaveLength(1);
    });

    it("returns nothing when disabled", async () => {
      const disabledCtx = await createTestContext({
        inlayHints: { enabled: false },
      });
      const disabledProcessor = new DocumentProcessor(disabledCtx);
      const disabledProvider = new InlayHintProvider(disabledCtx);
      const uri = disabledCtx.workspaceFolders[0].uri + "/disabled.s";
      const textDocument = TextDocument.create(uri, "vasmmot", 0, "A equ 1+2");
      await disabledProcessor.process(textDocument);

      const hints = await disabledProvider.onInlayHint({
        textDocument,
        range: wholeFile,
      });

      expect(hints).toEqual([]);
    });

    it("shows the evaluated value of a computed constant", async () => {
      const textDocument = await createDoc("computed.s", "A equ 1+2*3");

      const hints = await provider.onInlayHint({
        textDocument,
        range: wholeFile,
      });

      expect(hints).toEqual([
        expect.objectContaining({
          position: lsp.Position.create(0, 11),
          label: " = 7",
        }),
      ]);
    });

    it("skips a bare decimal literal", async () => {
      const textDocument = await createDoc("literal.s", "A equ 5");

      const hints = await provider.onInlayHint({
        textDocument,
        range: wholeFile,
      });

      expect(hints).toEqual([]);
    });

    it("shows the decimal value of a bare hex literal", async () => {
      const textDocument = await createDoc("hex-literal.s", "A equ $FF");

      const hints = await provider.onInlayHint({
        textDocument,
        range: wholeFile,
      });

      expect(hints).toEqual([
        expect.objectContaining({
          position: lsp.Position.create(0, 9),
          label: " = 255",
        }),
      ]);
    });

    it("resolves a reference to a constant defined earlier", async () => {
      const textDocument = await createDoc(
        "chained.s",
        `A equ 1+2*3
B = A+1`,
      );

      const hints = await provider.onInlayHint({
        textDocument,
        range: wholeFile,
      });

      expect(hints).toEqual([
        expect.objectContaining({
          position: lsp.Position.create(0, 11),
          label: " = 7",
        }),
        expect.objectContaining({
          position: lsp.Position.create(1, 7),
          label: " = 8",
        }),
      ]);
    });

    it("skips a constant that references an unresolvable symbol", async () => {
      const textDocument = await createDoc("unresolved.s", "C equ D+1");

      const hints = await provider.onInlayHint({
        textDocument,
        range: wholeFile,
      });

      expect(hints).toEqual([]);
    });

    it("still resolves earlier constants used outside the requested range", async () => {
      const textDocument = await createDoc(
        "ranged.s",
        `A equ 1+2*3
B = A+1`,
      );

      const hints = await provider.onInlayHint({
        textDocument,
        range: range(1, 0, 1, 100),
      });

      expect(hints).toEqual([
        expect.objectContaining({
          position: lsp.Position.create(1, 7),
          label: " = 8",
        }),
      ]);
    });
  });
});

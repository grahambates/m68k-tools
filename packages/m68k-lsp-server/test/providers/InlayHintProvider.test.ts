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

    const labels = async (filename: string, text: string) => {
      const textDocument = await createDoc(filename, text);
      const hints = await provider.onInlayHint({
        textDocument,
        range: wholeFile,
      });
      return (hints ?? []).map(({ position, label }) => [position.line, label]);
    };

    it("resolves a constant from one defined after it", async () => {
      expect(
        await labels("forward.s", ["A equ B*2", "B equ 1+2"].join("\n")),
      ).toEqual([
        [0, " = 6"],
        [1, " = 3"],
      ]);
    });

    it("resolves constants from RS offsets", async () => {
      expect(
        await labels(
          "offsets.s",
          [
            " rsreset",
            "Obj_x rs.w 1",
            "Obj_y rs.l 1",
            "Obj_sizeof rs.b 0",
            "TABLE_SIZE equ Obj_sizeof*8",
          ].join("\n"),
        ),
      ).toEqual([[4, " = 48"]]);
    });

    it("gives SET the value it has where it stands", async () => {
      expect(
        await labels(
          "set.s",
          [
            "X set 1+1",
            "Y equ X*10",
            "X set X+1",
            "Z set LATER",
            "LATER equ 9",
          ].join("\n"),
        ),
      ).toEqual([
        [0, " = 2"],
        [1, " = 20"],
        [2, " = 3"],
      ]);
    });

    it("skips constants in code that does not assemble", async () => {
      expect(
        await labels(
          "inactive.s",
          [" ifne 0", "A equ 1+1", " else", "B equ 2+2", " endc"].join("\n"),
        ),
      ).toEqual([[3, " = 4"]]);
    });

    it("reads symbols without case when vasm folds it", async () => {
      const folded = await createTestContext({
        inlayHints: { enabled: true },
        caseSensitive: false,
      });
      const textDocument = TextDocument.create(
        folded.workspaceFolders[0].uri + "/nocase.s",
        "vasmmot",
        0,
        ["Width equ 1+3", "AREA equ WIDTH*2"].join("\n"),
      );
      await new DocumentProcessor(folded).process(textDocument);
      const hints = await new InlayHintProvider(folded).onInlayHint({
        textDocument,
        range: wholeFile,
      });
      expect(hints?.map(({ label }) => label)).toEqual([" = 4", " = 8"]);
    });

    it("evaluates constants in a macro body from the file's constants", async () => {
      expect(
        await labels(
          "macro-body.s",
          ["SIZE equ 2+2", "M macro", "LOCAL equ SIZE*2", " endm"].join("\n"),
        ),
      ).toEqual([
        [0, " = 4"],
        [2, " = 8"],
      ]);
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

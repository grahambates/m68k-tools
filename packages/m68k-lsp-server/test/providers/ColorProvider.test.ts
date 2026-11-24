import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import DocumentProcessor from "../../src/DocumentProcessor";
import ColorProvider from "../../src/providers/ColorProvider";
import { createTestContext } from "../helpers";

describe("ColorProvider", () => {
  it("registers", async () => {
    const provider = new ColorProvider(await createTestContext());
    const conn = { onDocumentColor: vi.fn(), onColorPresentation: vi.fn() };
    expect(provider.register(conn as unknown as lsp.Connection)).toEqual({
      colorProvider: true,
    });
    expect(conn.onDocumentColor).toHaveBeenCalled();
    expect(conn.onColorPresentation).toHaveBeenCalled();
  });

  it("shows colour register values and writes picked colours back", async () => {
    const ctx = await createTestContext();
    const provider = new ColorProvider(ctx);
    const textDocument = TextDocument.create(
      ctx.workspaceFolders[0].uri + "/colours.s",
      "vasmmot",
      0,
      "copper:\n dc.w COLOR00,$0abc\n",
    );
    await new DocumentProcessor(ctx).process(textDocument);

    const [info] = await provider.onDocumentColor({ textDocument });
    expect(info.range).toEqual(lsp.Range.create(1, 14, 1, 19));

    const [presentation] = await provider.onColorPresentation({
      textDocument,
      range: info.range,
      color: { red: 1, green: 0, blue: 0, alpha: 1 },
    });
    expect(presentation).toEqual({
      label: "$0f00",
      textEdit: lsp.TextEdit.replace(info.range, "$0f00"),
    });
  });

  describe("constants", () => {
    const setup = async (name: string, text: string) => {
      const ctx = await createTestContext();
      const provider = new ColorProvider(ctx);
      const textDocument = TextDocument.create(
        ctx.workspaceFolders[0].uri + "/" + name,
        "vasmmot",
        0,
        text,
      );
      await new DocumentProcessor(ctx).process(textDocument);
      return { provider, textDocument };
    };
    const red = { red: 1, green: 0, blue: 0, alpha: 1 };

    it("shows a constant's colour where it is used and where it is defined", async () => {
      const { provider, textDocument } = await setup(
        "constant-colours.s",
        "BLUE equ $00f\ncopper:\n dc.w COLOR00,BLUE\n",
      );
      const ranges = (await provider.onDocumentColor({ textDocument })).map(
        ({ range }) => range,
      );
      expect(ranges).toEqual([
        lsp.Range.create(2, 14, 2, 18),
        lsp.Range.create(0, 9, 0, 13),
      ]);
    });

    it("changes the definition when a colour is picked at a use", async () => {
      const { provider, textDocument } = await setup(
        "constant-picker.s",
        "BLUE equ $00f\ncopper:\n dc.w COLOR00,BLUE\n",
      );
      const use = lsp.Range.create(2, 14, 2, 18);
      expect(
        await provider.onColorPresentation({
          textDocument,
          range: use,
          color: red,
        }),
      ).toEqual([
        {
          label: "$f00",
          textEdit: lsp.TextEdit.replace(use, "BLUE"),
          additionalTextEdits: [
            lsp.TextEdit.replace(lsp.Range.create(0, 9, 0, 13), "$f00"),
          ],
        },
      ]);
    });

    it("shows a palette defined in an include at both ends", async () => {
      const ctx = await createTestContext();
      const provider = new ColorProvider(ctx);
      const processor = new DocumentProcessor(ctx);
      const root = ctx.workspaceFolders[0].uri;
      // The include has to exist on disk to resolve; its text here is the same.
      const palette = TextDocument.create(
        root + "/palette.i",
        "vasmmot",
        0,
        "; Included by a colour test: a palette defined apart from its use.\nPAL_RED equ $f00\n",
      );
      const main = TextDocument.create(
        root + "/uses-palette.s",
        "vasmmot",
        0,
        ' include "palette.i"\ncopper:\n dc.w COLOR00,PAL_RED\n',
      );
      await processor.process(palette);
      await processor.process(main);

      const use = lsp.Range.create(2, 14, 2, 21);
      expect(
        (await provider.onDocumentColor({ textDocument: main })).map(
          ({ range }) => range,
        ),
      ).toEqual([use]);
      // The definition is in the include, which this document cannot edit.
      expect(
        await provider.onColorPresentation({
          textDocument: main,
          range: use,
          color: red,
        }),
      ).toEqual([]);
      expect(
        (await provider.onDocumentColor({ textDocument: palette })).map(
          ({ range }) => range,
        ),
      ).toEqual([lsp.Range.create(1, 12, 1, 16)]);
    });

    it("offers no edit for a constant defined by an expression", async () => {
      const { provider, textDocument } = await setup(
        "constant-expression.s",
        "BLUE equ $00f\nDARK equ BLUE/2\ncopper:\n dc.w COLOR00,DARK\n",
      );
      expect(
        await provider.onColorPresentation({
          textDocument,
          range: lsp.Range.create(3, 14, 3, 18),
          color: red,
        }),
      ).toEqual([]);
    });
  });
});

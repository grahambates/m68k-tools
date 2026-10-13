import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import HoverProvider from "../../src/providers/HoverProvider";
import { createTestContext, range } from "../helpers";

describe("HoverProvider", () => {
  let provider: HoverProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new HoverProvider(ctx);
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
        onHover: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onHover).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("hoverProvider");
    });
  });

  describe("#onHover()", () => {
    it("provide hover info for symbol reference", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 1
	move #foo,d1`,
      );

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(1, 9),
      });

      expect(hover).toEqual({
        range: range(1, 7, 1, 10),
        contents: [{ language: "vasmmot", value: "foo = 1" }],
      });
    });

    it("provide hover info for instructions", async () => {
      const textDocument = await createDoc("example.s", ` move #foo,d1`);

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(0, 3),
      });

      expect(hover).toEqual({
        range: range(0, 1, 0, 5),
        contents: {
          kind: "markdown",
          value: expect.stringMatching(
            /Move the contents of the source to the destination location/,
          ),
        },
      });
    });

    it("provide hover info for directives", async () => {
      const textDocument = await createDoc("example.s", ` section foo,bss`);

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(0, 3),
      });

      expect(hover).toEqual({
        range: range(0, 1, 0, 8),
        contents: {
          kind: "markdown",
          value: expect.stringMatching(/Starts a new section/),
        },
      });
    });

    it("provide hover info for size qualifier", async () => {
      const textDocument = await createDoc("example.s", ` move.w d0,d1`);

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(0, 6),
      });

      expect(hover).toEqual({
        range: range(0, 6, 0, 7),
        contents: {
          kind: "plaintext",
          value: expect.stringMatching(/Word/),
        },
      });
    });

    it("provide hover info for a path", async () => {
      const textDocument = await createDoc("example.s", ` include "example.i"`);

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(0, 13),
      });

      expect(hover).toEqual({
        range: range(0, 9, 0, 20),
        contents: {
          kind: "markdown",
          value: expect.stringMatching(/example\.i/),
        },
      });
    });

    it("provide hover for literals", async () => {
      const textDocument = await createDoc("example.s", ` move #40,d0`);

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(0, 7),
      });

      expect(hover).toEqual({
        range: range(0, 7, 0, 9),
        contents: {
          kind: "markdown",
          value: '40 | $28 | %101000 | @50 | "("',
        },
      });
    });

    it("provide hover info for a label definition", async () => {
      const textDocument = await createDoc(
        "example.s",
        `; Entry point
; of the demo
Start:
\trts`,
      );

      const hover = await provider.onHover({
        textDocument,
        position: { line: 2, character: 2 },
      });

      expect(hover).toBeTruthy();
      const contents = hover!.contents as string[];
      expect(contents[0]).toContain("Entry point");
      expect(contents).toContainEqual("(label) Start");
    });

    it("provide hover info for a constant definition", async () => {
      const textDocument = await createDoc("example.s", `foo equ 42`);

      const hover = await provider.onHover({
        textDocument,
        position: { line: 0, character: 1 },
      });

      expect(hover).toBeTruthy();
    });

    it("describes a general-purpose register from comments", async () => {
      const textDocument = await createDoc(
        "example.s",
        `; Inputs:
;   d0 = frame count
; Outputs:
;   d1 = total
Draw:
\tadd.w d0,d1
\trts`,
      );

      const hover = await provider.onHover({
        textDocument,
        position: { line: 5, character: 8 },
      });

      expect(hover?.range).toEqual(range(5, 7, 5, 9));
      expect(hover?.contents).toEqual({
        kind: lsp.MarkupKind.Markdown,
        value: "**D0**: frame count\n\n*Input, header of Draw*",
      });

      const output = await provider.onHover({
        textDocument,
        position: { line: 5, character: 11 },
      });
      expect((output?.contents as lsp.MarkupContent).value).toBe(
        "**D1**: output of Draw, total",
      );
    });

    describe("routine register summaries", () => {
      const source = `Caller:
\tbsr\tHelper
\tmoveq\t#0,d3
\trts
Helper:
\tmovem.l\td2/a2,-(sp)
\tmove.w\t(a0)+,d2
\tadd.w\td2,d0
\tmoveq\t#1,d1
\tmovem.l\t(sp)+,d2/a2
\trts
Vector:
\tmove.l\td4,d5
\tjsr\t(a6)
\trts`;
      const summaryAt = async (line: number, character: number) => {
        const textDocument = await createDoc("example.s", source);
        const hover = await provider.onHover({
          textDocument,
          position: { line, character },
        });
        return (hover?.contents as string[] | undefined)?.at(-1);
      };

      it("lists what a routine reads and modifies", async () => {
        expect(await summaryAt(4, 2)).toBe("Reads D0/A0 · Modifies D0–D1/A0");
      });

      it("shows the summary where the routine is called", async () => {
        expect(await summaryAt(1, 6)).toBe("Reads D0/A0 · Modifies D0–D1/A0");
      });

      it("includes what the routines it calls do", async () => {
        expect(await summaryAt(0, 2)).toBe(
          "Reads D0/A0 · Modifies D0–D1/D3/A0",
        );
      });

      const summaryOf = async (text: string) => {
        const textDocument = await createDoc("example.s", text);
        const hover = await provider.onHover({
          textDocument,
          position: { line: 0, character: 2 },
        });
        return (hover?.contents as string[]).at(-1);
      };

      it("does not count changes a stack restore undoes", async () => {
        // A range across data and address registers, as vasm reads it.
        expect(
          await summaryOf(`Everything:
\tmovem.l\td0-a6,-(sp)
\tmoveq\t#0,d0
\tmove.l\td0,a3
\tmovem.l\t(sp)+,d0-a6
\tmoveq\t#1,d1
\trts`),
        ).toBe("Modifies D1");
      });

      it.each([
        ["", "Reads D0/D2 · Modifies D0"],
        ["\tmoveq\t#5,d2\n", "Reads D0/D2 · Modifies D0/D2"],
      ])(
        "pairs each restore with its own save when a register is stashed twice (%j)",
        async (after, expected) => {
          expect(
            await summaryOf(`Twice:
\tmovem.l\td2,-(sp)
\tmoveq\t#0,d2
\tmovem.l\t(sp)+,d2
\tadd.l\td2,d0
\tmove.l\td2,-(sp)
\tmoveq\t#1,d2
\tmove.l\t(sp)+,d2
${after}\trts`),
          ).toBe(expected);
        },
      );

      it("notes code it could not analyse", async () => {
        expect(await summaryAt(11, 2)).toBe(
          "Reads D4/A6 and possibly others · Modifies D5 and possibly others",
        );
      });
    });

    it("describes the registers in a list that have descriptions", async () => {
      const textDocument = await createDoc(
        "example.s",
        `; d0 = frame count
; a0 = screen
Draw:
\tmovem.l\td0-d1/a0,-(sp)
\trts`,
      );

      const hover = await provider.onHover({
        textDocument,
        position: { line: 3, character: 10 },
      });
      expect(hover?.range).toEqual(range(3, 9, 3, 17));
      expect((hover?.contents as lsp.MarkupContent).value).toBe(
        "**D0**: frame count\n\n*Input, header of Draw*\n\n***\n\n**A0**: screen\n\n*Input, header of Draw*",
      );
    });

    it("describes the register behind an alias", async () => {
      const textDocument = await createDoc(
        "example.s",
        `count equr d0
Draw:
\tmoveq\t#0,count\t; count of frames
\taddq.w\t#1,count
\trts`,
      );

      const hover = await provider.onHover({
        textDocument,
        position: { line: 3, character: 12 },
      });
      expect(hover?.contents).toEqual([
        { language: "vasmmot", value: "count equr d0" },
        "**D0**: count of frames\n\n*Inferred from comment, line 3*",
      ]);
    });

    it("describes a register assigned from a symbol", async () => {
      const textDocument = await createDoc(
        "example.s",
        `Draw:
\tlea\tSomeTable,a0
\tmove.w\t(a0)+,d0\t; d0 = first entry
\trts`,
      );

      const at = async (line: number, character: number) =>
        (
          (
            await provider.onHover({
              textDocument,
              position: { line, character },
            })
          )?.contents as lsp.MarkupContent | undefined
        )?.value;

      expect(await at(2, 9)).toBe(
        "**A0**: address of `SomeTable`\n\n*Assigned on line 2*",
      );
      expect(await at(2, 14)).toBe("**D0**: first entry\n\n*Comment, line 3*");
    });

    it("describes registers within a macro body", async () => {
      const textDocument = await createDoc(
        "example.s",
        `; d0 = count
Wait\tmacro
\tsubq.w\t#1,d0
\tbne.s\t*-2
\tendm`,
      );

      const hover = await provider.onHover({
        textDocument,
        position: { line: 2, character: 12 },
      });
      expect((hover?.contents as lsp.MarkupContent).value).toBe(
        "**D0**: count\n\n*Input, header of Wait*",
      );
    });

    it("gives no register hover without a description", async () => {
      const textDocument = await createDoc(
        "example.s",
        `Draw:
\tmoveq\t#0,d0
\trts`,
      );

      const hover = await provider.onHover({
        textDocument,
        position: { line: 1, character: 10 },
      });
      expect(hover).toBeUndefined();
    });
  });
});

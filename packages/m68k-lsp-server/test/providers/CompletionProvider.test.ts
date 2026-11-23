import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import CompletionProvider from "../../src/providers/CompletionProvider";
import { createTestContext } from "../helpers";

describe("CompletionProvider", () => {
  let provider: CompletionProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new CompletionProvider(ctx);
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
        onCompletion: vi.fn(),
        onCompletionResolve: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onCompletion).toHaveBeenCalled();
      expect(conn.onCompletionResolve).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("completionProvider");
    });
  });

  describe("#onCompletion()", () => {
    it("uses the source operand to suggest address registers and matching aliases", async () => {
      const source =
        "Table equ 7\nPtr equr a2\nCount equr d3\nSaved reg a2\n move.l usp,";
      const textDocument = await createDoc("usp-completion.s", source);
      const labels = (
        await provider.onCompletion({
          textDocument,
          position: lsp.Position.create(4, source.split("\n")[4].length),
        })
      ).map(({ label }) => label);

      expect(labels).toContain("a0");
      expect(labels).toContain("Ptr");
      expect(labels).not.toContain("d0");
      expect(labels).not.toContain("Count");
      expect(labels).not.toContain("Saved");
      expect(labels).not.toContain("Table");
    });

    it("keeps alternatives open when the earlier operand is a macro parameter", async () => {
      const source = " move.l \\1,";
      const textDocument = await createDoc("unknown-operand.s", source);
      const items = await provider.onCompletion({
        textDocument,
        position: lsp.Position.create(0, source.length),
      });
      expect(items.map(({ label }) => label)).toEqual(
        expect.arrayContaining(["d0", "a0"]),
      );
    });

    it("uses the existing operands when completing a size suffix", async () => {
      const textDocument = await createDoc(
        "size-with-operands.s",
        " move. usp,a0",
      );
      const items = await provider.onCompletion({
        textDocument,
        position: lsp.Position.create(0, 6),
      });
      expect(items.map(({ label }) => label)).toEqual(["l"]);
    });

    it("offers register lists after a movem memory source", async () => {
      const textDocument = await createDoc(
        "movem-completion.s",
        "Saved reg d2-d4/a2\nTable equ 7\n movem.l (a1)+,",
      );
      const items = await provider.onCompletion({
        textDocument,
        position: lsp.Position.create(2, 15),
      });
      expect(items.map(({ label }) => label)).toEqual(
        expect.arrayContaining(["Saved", "d0", "a0"]),
      );
      expect(items.map(({ label }) => label)).not.toContain("Table");
    });

    it("completes mnemonics", async () => {
      const textDocument = await createDoc("example.s", "  mov");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 4),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "move" }),
      );
    });

    it("excludes unsupported mnemonics", async () => {
      const textDocument = await createDoc("example.s", "  mov");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 4),
        textDocument,
      });

      expect(completions).not.toContainEqual(
        expect.objectContaining({ label: "movec" }),
      );
    });

    it("includes supported mnemonics", async () => {
      const textDocument = await createDoc("example.s", "  mov");
      const ctx020: Context = {
        ...ctx,
        config: {
          ...ctx.config,
          processors: ["mc68000", "mc68020"],
        },
      };
      const provider020 = new CompletionProvider(ctx020);

      const completions = await provider020.onCompletion({
        position: lsp.Position.create(0, 4),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "movec" }),
      );
    });

    it("matches case on mnemonics", async () => {
      const textDocument = await createDoc("example.s", "  MOV");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 4),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "MOVE" }),
      );
    });

    it("completes sizes", async () => {
      const textDocument = await createDoc("example.s", "  move.");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 7),
        textDocument,
      });

      expect(completions).toEqual([
        expect.objectContaining({ label: "b" }),
        expect.objectContaining({ label: "w", preselect: true }),
        expect.objectContaining({ label: "l" }),
      ]);
    });

    it("matches case on sizes", async () => {
      const textDocument = await createDoc("example.s", "  MOVE.");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 7),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "W" }),
      );
    });

    it("completes an operand with registers", async () => {
      const textDocument = await createDoc("example.s", "  move d");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 8),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "d0" }),
      );
    });

    it("matches case on registers", async () => {
      const textDocument = await createDoc("example.s", "  move D");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 8),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "D0" }),
      );
    });

    it("completes an operand on first character", async () => {
      const textDocument = await createDoc("example.s", "  move ");

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 7),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "d0" }),
      );
    });

    it("completes an operand with a symbol", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 1
  move f
      `,
      );

      const completions = await provider.onCompletion({
        position: lsp.Position.create(1, 8),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "foo" }),
      );
    });

    it("completes local symbols", async () => {
      const textDocument = await createDoc(
        "example.s",
        `global1:
.local1:
global2:
.local2:
  bsr .l
global3:
.local3:
      `,
      );

      const completions = await provider.onCompletion({
        position: lsp.Position.create(4, 8),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: ".local2" }),
      );
      expect(completions).not.toContainEqual(
        expect.objectContaining({ label: ".local1" }),
      );
      expect(completions).not.toContainEqual(
        expect.objectContaining({ label: ".local3" }),
      );
    });

    it("doesn't complete labels", async () => {
      const textDocument = await createDoc("example.s", `fo`);

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 2),
        textDocument,
      });

      expect(completions).toHaveLength(0);
    });

    describe("label definitions", () => {
      const complete = async (name: string, source: string, line: number) => {
        const textDocument = await createDoc(name, source);
        const lines = source.split("\n");
        const character = /^\S*/.exec(lines[line])![0].length;
        return provider.onCompletion({
          textDocument,
          position: lsp.Position.create(line, character),
        });
      };

      it("offers local labels the routine uses but does not define", async () => {
        const items = await complete(
          "undefined-locals.s",
          [
            "Other:",
            " bra .elsewhere",
            "Routine:",
            " moveq #7,d0",
            ".loop:",
            " dbf d0,.loop",
            " beq .done",
            " bra .skip",
            ".",
            "Next:",
            " bra .later",
          ].join("\n"),
          8,
        );
        const labels = items.map(({ label }) => label).sort();

        expect(labels).toEqual([".done", ".skip"]);
        expect(items[0]).toMatchObject({
          textEdit: {
            range: { start: { character: 0 }, end: { character: 1 } },
          },
        });
      });

      it("replaces the label typed so far", async () => {
        const items = await complete(
          "partial-local.s",
          "Routine:\n bne .again\n.ag",
          2,
        );

        expect(items).toEqual([
          expect.objectContaining({
            label: ".again",
            detail: "(undefined label) used on line 2",
            textEdit: lsp.TextEdit.replace(
              lsp.Range.create(2, 0, 2, 3),
              ".again",
            ),
          }),
        ]);
      });

      it("offers a global label nothing defines", async () => {
        const items = await complete(
          "undefined-globals.s",
          "Start:\n bsr Init\n bsr Start\n jmp Main\nIn",
          4,
        );

        expect(items.map(({ label }) => label).sort()).toEqual([
          "Init",
          "Main",
        ]);
      });

      it("counts a label defined after a new one being typed", async () => {
        const items = await complete(
          "defined-later.s",
          "Routine:\n bra .end\nNe\n nop\n.end:\n rts",
          2,
        );

        expect(items.map(({ label }) => label)).not.toContain(".end");
      });

      it("ignores names used in macro bodies", async () => {
        const items = await complete(
          "macro-body-refs.s",
          "Wait macro\n bra .poll\n endm\nRoutine:\n.",
          4,
        );

        expect(items).toHaveLength(0);
      });

      it("offers labels at the start of an empty line when asked", async () => {
        const items = await complete(
          "empty-line.s",
          "Routine:\n bra .out\n\n rts",
          2,
        );

        expect(items.map(({ label }) => label)).toEqual([".out"]);
      });

      it("offers labels used in another file of the unit", async () => {
        // The included file has to exist on disk for the include to resolve.
        await createDoc(
          "uses-setup.s",
          ` include "label-completion.i"\n bsr Setup`,
        );
        const items = await complete(
          "label-completion.i",
          "; Included by a completion test that uses a label defined nowhere yet.\nSe\n",
          1,
        );

        expect(items).toEqual([
          expect.objectContaining({
            label: "Setup",
            detail: "(undefined label) used in uses-setup.s:2",
          }),
        ]);
      });
    });

    it("doesn't complete on first character of line", async () => {
      const textDocument = await createDoc("example.s", ``);

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, 0),
        textDocument,
      });

      expect(completions).toHaveLength(0);
    });

    it("completes include paths", async () => {
      const line = ` include "ex`;
      const textDocument = await createDoc("example.s", line);

      const completions = await provider.onCompletion({
        position: lsp.Position.create(0, line.length),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({ label: "example.i" }),
      );
    });

    it("includes comment documentation before declaration", async () => {
      const textDocument = await createDoc(
        "example.s",
        `; test 123
; example
foo = 123
 move fo`,
      );

      const completions = await provider.onCompletion({
        position: lsp.Position.create(2, 9),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({
          documentation: { kind: "markdown", value: "test 123  \nexample" },
        }),
      );
    });

    it("includes comment documentation on same line as declaration", async () => {
      const textDocument = await createDoc(
        "example.s",
        `foo = 123 ; example
 move fo`,
      );

      const completions = await provider.onCompletion({
        position: lsp.Position.create(1, 8),
        textDocument,
      });

      expect(completions).toContainEqual(
        expect.objectContaining({
          documentation: { kind: "markdown", value: "example" },
        }),
      );
    });

    // TODO: signature specific operand competions
  });

  describe("#onCompletionResolve()", () => {
    it("adds documentation", () => {
      const item = provider.onCompletionResolve({
        label: "move",
        data: true,
      });
      expect(item.documentation).toBeTruthy();
      expect(lsp.MarkupContent.is(item.documentation)).toBe(true);
      if (lsp.MarkupContent.is(item.documentation)) {
        expect(item.documentation.value).toContain("MOVE");
      }
    });

    it("does not offer labels from an unrelated program", async () => {
      // Two entry points sharing only an include. Neither can see the other's
      // labels, so neither should suggest them.
      await createDoc(
        "otherUnit.s",
        ` include "example.i"
OnlyInOther:
 rts`,
      );
      const doc = await createDoc(
        "thisUnit.s",
        ` include "example.i"
OnlyInThis:
 bsr O`,
      );

      const items = await provider.onCompletion({
        textDocument: doc,
        position: lsp.Position.create(2, 6),
      });
      const labels = items.map((i) => i.label);

      expect(labels).toContain("OnlyInThis");
      expect(labels).not.toContain("OnlyInOther");
    });

    it("offers symbols from an included file", async () => {
      const doc = await createDoc(
        "includer.s",
        ` include "example.i"
Start:
 move #f`,
      );

      const items = await provider.onCompletion({
        textDocument: doc,
        position: lsp.Position.create(2, 8),
      });

      // `foo` is defined in example.i
      expect(items.map((i) => i.label)).toContain("foo");
    });
  });
});

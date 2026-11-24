import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import { formatNumber } from "../../src/formatting";
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
    it("shows substituted macro code on the call's mnemonic", async () => {
      const textDocument = await createDoc(
        "macro-hover.s",
        "Load macro\n moveq #\\1,\\2\n endm\n Load 7,d2",
      );

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(3, 2),
      });

      expect(hover?.range).toEqual(range(3, 1, 3, 5));
      expect(hover?.contents).toEqual({
        kind: lsp.MarkupKind.Markdown,
        value: "**Macro expansion**\n\n```m68k\n moveq #7,d2\n```",
      });
    });

    it("shows macro expansion lines beyond the visible hover area", async () => {
      const textDocument = await createDoc(
        "long-macro-hover.s",
        [
          "LongMacro macro",
          ...Array(12).fill(" nop"),
          " rts",
          " endm",
          " LongMacro",
        ].join("\n"),
      );

      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(15, 2),
      });

      const value = (hover?.contents as lsp.MarkupContent).value;
      expect(value.match(/ nop/g)).toHaveLength(12);
      expect(value).toContain(" rts");
      expect(value).not.toContain("Partial preview");
    });

    it("marks an incomplete expansion without editor-specific instructions", async () => {
      const textDocument = await createDoc(
        "recursive-macro-hover.s",
        "Recursive macro\n Recursive\n endm\n Recursive",
      );
      const hover = await provider.onHover({
        textDocument,
        position: lsp.Position.create(3, 2),
      });
      const value = (hover?.contents as lsp.MarkupContent).value;
      expect(value.split("\n").slice(-2)).toEqual(["", "Partial preview."]);
    });

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
        contents: [
          { language: "vasmmot", value: "foo = 1 ($1)" },
          formatNumber(1),
        ],
      });
    });

    it("shows simple decimal and hex assignments on one line", async () => {
      const doc = await createDoc(
        "literal-assignments.s",
        "FOO = 256\nBAR equ $100\n",
      );
      for (const [line, value] of [
        "FOO = 256 ($100)",
        // Written in hexadecimal, so shown hexadecimal first.
        "BAR equ $100 (256)",
      ].entries()) {
        const hover = await provider.onHover({
          textDocument: doc,
          position: lsp.Position.create(line, 1),
        });
        expect(hover?.contents).toEqual([
          { language: "vasmmot", value },
          formatNumber(256),
        ]);
      }
    });

    it("shows evaluated constants and whole operand expressions in decimal and hex", async () => {
      const document = await createDoc(
        "expression-hover.s",
        [
          "SCREEN_BW equ 40",
          "SCREEN_H equ 200",
          "BPLS equ 4",
          "SCREEN_SIZE = SCREEN_BW*SCREEN_H*BPLS",
          " move.l #(SCREEN_SIZE/2)+4,d0",
          " move.l #(UNKNOWN+4),d0",
        ].join("\n"),
      );
      const hover = (line: number, character: number) =>
        provider.onHover({
          textDocument: document,
          position: lsp.Position.create(line, character),
        });
      expect((await hover(3, 4))?.contents).toEqual([
        {
          language: "vasmmot",
          value:
            "SCREEN_SIZE = SCREEN_BW*SCREEN_H*BPLS\n            = 32000 ($7D00)",
        },
        formatNumber(32000),
      ]);
      const operand = await hover(4, 16);
      expect(operand?.range).toEqual(range(4, 9, 4, 26));
      expect(operand?.contents).toEqual([
        {
          language: "vasmmot",
          value:
            "SCREEN_SIZE = SCREEN_BW*SCREEN_H*BPLS\n            = 32000 ($7D00)\nExpression = 16004 ($3E84)",
        },
        // The expression's value, the one asked about, in every form.
        formatNumber(16004),
      ]);
      expect((await hover(4, 8))?.contents).toEqual([
        { language: "vasmmot", value: "Expression = 16004 ($3E84)" },
        formatNumber(16004),
      ]);
      expect(await hover(5, 13)).toBeUndefined();
    });

    describe("addresses", () => {
      const source = [
        "custom equ $DFF000",
        "intena equ $09A",
        "WIDTH equ 320",
        " lea custom,a6",
        " move.w #$7fff,custom+intena",
        " move.w #$7fff,intena(a6)",
        " move.l #custom,a5",
        " lea WIDTH(pc),a0",
        " move.w #WIDTH,d0",
      ].join("\n");
      const code = async (line: number, character: number) => {
        const textDocument = await createDoc("address-hover.s", source);
        const hover = await provider.onHover({
          textDocument,
          position: lsp.Position.create(line, character),
        });
        return (
          (hover?.contents as (string | { value: string })[])
            .map((part) => (typeof part === "string" ? part : part.value))
            // The code block alone: the value's forms and any hardware docs follow.
            .slice(0, 1)
        );
      };

      it.each([
        ["an absolute address", 3, 6, ["custom equ $DFF000"]],
        [
          "an absolute address expression",
          4,
          17,
          ["custom equ $DFF000\nExpression = $DFF09A"],
        ],
        [
          "an immediate moved into an address register",
          6,
          10,
          ["custom equ $DFF000"],
        ],
        ["a PC-relative target", 7, 6, ["WIDTH equ $140"]],
      ])(
        "shows hexadecimal alone in %s",
        async (_what, line, character, expected) => {
          expect(await code(line, character)).toEqual(expected);
        },
      );

      it("keeps decimal first for an offset from a register", async () => {
        expect(await code(5, 16)).toEqual(["intena equ $9A (154)"]);
      });

      it("keeps decimal first for data", async () => {
        expect(await code(8, 10)).toEqual(["WIDTH equ 320 ($140)"]);
      });

      it("keeps a hexadecimal definition hexadecimal first", async () => {
        expect(await code(0, 1)).toEqual(["custom equ $DFF000 (14675968)"]);
      });
    });

    describe("Amiga hardware symbols", () => {
      const hoverText = async (
        source: string,
        line: number,
        column: number,
      ) => {
        const textDocument = await createDoc("amiga-hardware.s", source);
        const hover = await provider.onHover({
          textDocument,
          position: lsp.Position.create(line, column),
        });
        const contents = hover?.contents;
        if (!contents) return "";
        return (Array.isArray(contents) ? contents : [contents])
          .map((part) => (typeof part === "string" ? part : part.value))
          .join("\n");
      };

      it("documents a register named by the includes, defined or not", async () => {
        const text = await hoverText(" move.w #$7fff,intena(a6)", 0, 17);
        expect(text).toContain(
          "**INTENA** · $DFF09A · write *(also INTENAR $DFF01C, read)*",
        );
        expect(text).toContain(
          "| 5 | VERTB | Level 3: Start of vertical blank |",
        );
        expect(text).toContain(
          "[Hardware Reference Manual](http://amigadev.elowar.com/read/ADCD_2.1/Hardware_Manual_guide/node0036.html)",
        );
      });

      it("adds the docs beneath the symbol's own value, in either case", async () => {
        const text = await hoverText(
          "INTENA equ $09a\n move.w #$7fff,INTENA(a6)",
          1,
          17,
        );
        expect(text).toContain("INTENA equ $9A (154)");
        expect(text).toContain("**INTENA** · $DFF09A");
      });

      it("accepts the register's absolute address as its value", async () => {
        const text = await hoverText(
          "dmacon equ $dff096\n move.w d0,dmacon",
          1,
          12,
        );
        expect(text).toContain("**DMACON** · $DFF096");
      });

      it("documents the definition of a register symbol", async () => {
        expect(await hoverText("intreq equ $09c", 0, 2)).toContain(
          "**INTREQ** · $DFF09C",
        );
      });

      it("finds numbered registers and pointer pairs", async () => {
        expect(await hoverText(" move.w d0,COLOR17(a6)", 0, 14)).toContain(
          "**COLOR17** · $DFF1A2 · write",
        );
        expect(await hoverText(" move.l d0,cop1lc(a6)", 0, 13)).toContain(
          "**COP1LC** · $DFF080 · long, COP1LCH/COP1LCL",
        );
      });

      it("documents the include files' flags", async () => {
        const source = " move.w #DMAF_SETCLR|DMAF_SPRITE,dmacon(a6)";
        expect(await hoverText(source, 0, 23)).toContain(
          "**DMAF_SPRITE** · DMACON bit 5 · mask $0020\n\nSPREN: Sprite DMA",
        );
        expect(await hoverText(" btst #INTB_VERTB,d0", 0, 10)).toContain(
          "**INTB_VERTB** · INTENA/INTREQ bit 5\n\nVERTB: Level 3: Start of vertical blank",
        );
      });

      it("says nothing of a symbol that only shares a register's name", async () => {
        expect(
          await hoverText("intena equ 5\n move.w d0,intena(a6)", 1, 13),
        ).not.toContain("**INTENA**");
        expect(
          await hoverText("DMAF_SPRITE equ 3\n move.w #DMAF_SPRITE,d0", 1, 12),
        ).not.toContain("DMACON");
      });

      it("labels registers and bits ECS and AGA added", async () => {
        expect(await hoverText(" move.w d0,fmode(a6)", 0, 12)).toContain(
          "**FMODE** · $DFF1FC · write · AGA",
        );
        // A numbered register's own chip set, though its family is older.
        expect(await hoverText(" move.l d0,bpl7pt(a6)", 0, 12)).toContain(
          "**BPL7PT** · $DFF0F8 · long, BPL7PTH/BPL7PTL · AGA",
        );
        const bplcon0 = await hoverText(" move.w d0,bplcon0(a6)", 0, 12);
        expect(bplcon0).not.toContain("· ECS");
        expect(bplcon0).toContain(
          "| 6 | SHRES | Super high resolution (35 ns pixels); clear HIRES with it (ECS) |",
        );
      });

      it("says nothing of other symbols", async () => {
        expect(await hoverText(" move.w d0,foo(a6)", 0, 12)).toBe("");
      });

      describe("values written to registers", () => {
        it.each([
          [
            "a set",
            " move.w #$8020,dmacon(a6)",
            9,
            "Written to **DMACON**: Sets SPREN",
          ],
          [
            "a clear",
            " move.w #$7fff,INTENA(a6)",
            9,
            "Written to **INTENA**: Clears INTEN, EXTER, DSKSYN, RBF, AUD3, AUD2, AUD1, AUD0, BLIT, VERTB, COPER, PORTS, SOFT, DSKBLK, TBE",
          ],
          [
            "bits and fields",
            " move.w #$4204,custom+bplcon0",
            9,
            "Written to **BPLCON0**: BPU = 4 · COLOR · LACE",
          ],
          [
            "a copper list",
            " dc.w COLOR00,$0f80,BPLCON0,$1200",
            16,
            "Written to **COLOR00**: R = 15 · G = 8 · B = 0",
          ],
          [
            "the second pair in a copper list",
            " dc.w COLOR00,$0f80,BPLCON0,$1200",
            30,
            "Written to **BPLCON0**: BPU = 1 · COLOR",
          ],
          [
            "a size where 0 means the most",
            " move.w #(200<<6),bltsize(a6)",
            12,
            "Written to **BLTSIZE**: H = 200 · W = 64",
          ],
          [
            "AGA bits",
            " move.w #$0211,bplcon0(a6)",
            9,
            "Written to **BPLCON0**: BPU = 0 · COLOR · BPU3 · ECSENA",
          ],
          [
            "scroll values for the original chips",
            " move.w #$008f,bplcon1(a6)",
            9,
            "Written to **BPLCON1**: PF2H = 8 · PF1H = 15",
          ],
          [
            "AGA scroll bits, each by its own name",
            " move.w #$c08f,bplcon1(a6)",
            9,
            "Written to **BPLCON1**: PF2H7–PF2H6 = 3 · PF2H3–PF2H0 = 8 · PF1H = 15",
          ],
          [
            "fields that share a name, by their descriptions",
            " move.w #$2102,diwhigh(a6)",
            9,
            "Written to **DIWHIGH**: H8 · Vertical stop, high bits = 1 · Vertical start, high bits = 2",
          ],
          [
            "unused bits",
            " move.w #$9800,dmacon(a6)",
            9,
            "Written to **DMACON**: Sets nothing. Bits not described here: 12, 11",
          ],
        ])("decodes %s", async (_what, source, column, expected) => {
          expect(await hoverText(source, 0, column)).toContain(expected);
        });

        it("reads standard flags the project does not define", async () => {
          const text = await hoverText(
            " move.w #DMAF_SETCLR|DMAF_SPRITE|DMAF_COPPER,dmacon(a6)",
            0,
            22,
          );
          // The flag under the cursor, then the whole value.
          expect(text).toContain("**DMAF_SPRITE** · DMACON bit 5");
          expect(text).toContain("Written to **DMACON**: Sets COPEN, SPREN");
        });

        it("uses the project's own value for a flag it defines", async () => {
          const text = await hoverText(
            "DMAF_SPRITE equ $0010\n move.w #$8000|DMAF_SPRITE,dmacon(a6)",
            1,
            9,
          );
          expect(text).toContain("Written to **DMACON**: Sets DSKEN");
        });

        it.each([
          ["a partial write", " or.w #$8020,dmacon(a6)", 8],
          ["a long write", " move.l #$8020,dmacon(a6)", 10],
          ["an unknown value", " move.w #FOO,dmacon(a6)", 10],
          ["a register without bits", " move.w #40,bpl1mod(a6)", 9],
          [
            "a register that is not one",
            "dmacon equ 4\n move.w #$8020,dmacon(a6)",
            9,
          ],
        ])("leaves %s alone", async (_what, source, column) => {
          const lines = source.split("\n");
          expect(
            await hoverText(source, lines.length - 1, column),
          ).not.toContain("Written to");
        });
      });
    });

    it("uses the SET value in effect at the hovered operand", async () => {
      const document = await createDoc(
        "set-hover.s",
        "COUNT set 3\n move #COUNT*2,d0\nCOUNT set 7\n",
      );
      const result = await provider.onHover({
        textDocument: document,
        position: lsp.Position.create(1, 9),
      });
      expect(result?.contents).toContainEqual(
        expect.objectContaining({
          language: "vasmmot",
          value: expect.stringContaining("3 ($3)\nExpression = 6 ($6)"),
        }),
      );
    });

    it("shows values at immediate and displacement use sites in templates", async () => {
      const document = await createDoc(
        "operand-use-hover.s",
        [
          "SIZE equ 32",
          "TEST macro",
          " add.l #SIZE,a0",
          " lea SIZE(a0),a0",
          " move.l #(unresolved+SIZE),d0",
          " endm",
          " rept 3",
          " add.l #SIZE+4,a0",
          " endr",
        ].join("\n"),
      );
      const hover = (line: number, character: number) =>
        provider.onHover({
          textDocument: document,
          position: lsp.Position.create(line, character),
        });
      for (const [line, column] of [
        [2, 7],
        [2, 10],
        [3, 6],
        [4, 24],
      ]) {
        expect((await hover(line, column))?.contents).toContainEqual(
          expect.objectContaining({
            language: "vasmmot",
            value: expect.stringContaining("32 ($20)"),
          }),
        );
      }
      expect((await hover(7, 10))?.contents).toContainEqual(
        expect.objectContaining({
          language: "vasmmot",
          value: expect.stringContaining("Expression = 36 ($24)"),
        }),
      );
    });

    describe("offsets and constants defined later", () => {
      const source = [
        " rsreset",
        "Obj_x rs.w 1",
        "Obj_y rs.w 1",
        "Obj_flags rs.b 1",
        "Obj_sizeof rs.b 0",
        " move.w Obj_y(a0),d0",
        " lea Obj_sizeof*4(a1),a1",
        "A equ B*2",
        " move.w #A,d0",
        "B equ Later_sizeof",
        " rsreset",
        "Later_a rs.l 3",
        "Later_sizeof rs.b 0",
      ].join("\n");
      const hoverCode = async (line: number, character: number) => {
        const textDocument = await createDoc("offset-hover.s", source);
        const hover = await provider.onHover({
          textDocument,
          position: lsp.Position.create(line, character),
        });
        return (hover?.contents as (string | { value: string })[]).map(
          (part) => (typeof part === "string" ? part : part.value),
        );
      };

      it.each([
        [2, 1, "Obj_y rs.w 1\n      = 2 ($2)", 2],
        [4, 2, "Obj_sizeof rs.b 0\n           = 5 ($5)", 5],
        [11, 2, "Later_a rs.l 3\n        = 0 ($0)", 0],
      ])(
        "shows the offset an RS label takes, on line %i",
        async (line, character, code, value) => {
          expect(await hoverCode(line, character)).toEqual([
            code,
            formatNumber(value),
          ]);
        },
      );

      it("shows offsets where they are used", async () => {
        expect(await hoverCode(5, 10)).toEqual([
          "Obj_y rs.w 1\n      = 2 ($2)",
          formatNumber(2),
        ]);
        expect(await hoverCode(6, 8)).toEqual([
          "Obj_sizeof rs.b 0\n           = 5 ($5)\nExpression = 20 ($14)",
          formatNumber(20),
        ]);
      });

      it("resolves constants through later constants and offsets", async () => {
        expect(await hoverCode(7, 0)).toEqual([
          "A equ B*2\n  = 24 ($18)",
          formatNumber(24),
        ]);
        expect(await hoverCode(8, 10)).toEqual([
          "A equ B*2\n  = 24 ($18)",
          formatNumber(24),
        ]);
        expect(await hoverCode(9, 0)).toEqual([
          "B equ Later_sizeof\n  = 12 ($C)",
          formatNumber(12),
        ]);
      });
    });

    it("resolves a forward equate in operands without using it in a condition", async () => {
      const document = await createDoc(
        "forward-operand-hover.s",
        [
          "HEIGHT = 128",
          " move.w #SCROLL_ROW,(a2)+",
          " lea SCROLL_ROW*2(a1),a1",
          " ifeq SCROLL_ROW",
          " nop",
          " endc",
          "SCROLL_ROW = HEIGHT",
        ].join("\n"),
      );
      const hover = (line: number, character: number) =>
        provider.onHover({
          textDocument: document,
          position: lsp.Position.create(line, character),
        });
      expect((await hover(1, 12))?.contents).toEqual([
        {
          language: "vasmmot",
          value: "SCROLL_ROW = HEIGHT\n           = 128 ($80)",
        },
        formatNumber(128),
      ]);
      expect((await hover(2, 10))?.contents).toEqual([
        {
          language: "vasmmot",
          value:
            "SCROLL_ROW = HEIGHT\n           = 128 ($80)\nExpression = 256 ($100)",
        },
        formatNumber(256),
      ]);
      expect((await hover(3, 9))?.contents).toEqual([
        { language: "vasmmot", value: "SCROLL_ROW = HEIGHT" },
      ]);
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

    describe("documents the instruction the operands select", () => {
      const hoverValue = async (
        source: string,
        line = source.split("\n").length - 1,
      ) => {
        const textDocument = await createDoc("variant.s", source);
        const hover = await provider.onHover({
          textDocument,
          position: lsp.Position.create(line, 2),
        });
        return (hover?.contents as lsp.MarkupContent).value;
      };

      it.each([
        [" cmp.w d0,a1", "CMPA", "Compare Address"],
        [" move.l d0,a0", "MOVEA", "Move Address"],
        [" add.w #5,(a0)", "ADDI", "Add Immediate"],
        [" cmp.b (a0)+,(a1)+", "CMPM", "Compare Memory"],
        [" eor.w #5,d0", "EORI", "Logical Exclusive-OR Immediate"],
        [" dbra d0,*", "DBF", "Test Condition, Decrement and Branch"],
        [" move.w d0,ccr", "MOVE to CCR", "Move to Condition Code Register"],
        [
          " move.w ccr,d0",
          "MOVE from CCR",
          "Move from Condition Code Register",
        ],
        [" move.w #$2700,sr", "MOVE to SR", "Move to Status Register"],
        [" move.w sr,-(sp)", "MOVE from SR", "Move from Status Register"],
        [" move.l usp,a0", "MOVE USP", "Move User Stack Pointer"],
        [" and.b #1,ccr", "ANDI to CCR", "AND Immediate to Condition Code"],
        [" andi.w #$f8ff,sr", "ANDI to SR", "AND Immediate to Status Register"],
        [" or.b #4,ccr", "ORI to CCR", "Inclusive-OR Immediate to Condition"],
        [
          " eori.b #1,ccr",
          "EORI to CCR",
          "Exclusive-OR Immediate to Condition",
        ],
      ])("%s as %s", async (source, encoded, summary) => {
        const value = await hoverValue(source);
        expect(value.startsWith(`Assembled as **${encoded}**\n`)).toBe(true);
        expect(value).toContain(`**${summary}`);
      });

      it("shows only the form in use", async () => {
        const value = await hoverValue(" move.w d0,ccr");
        expect(value).toContain("move[.w] <source>,CCR");
        expect(value).not.toContain("USP");
        expect(value).not.toContain("<destination>");
        // Every flag comes from the source, unlike a plain MOVE.
        expect(value).toContain("| * | * | * | * | * |");
      });

      it("shows the plain form without the special register ones", async () => {
        const value = await hoverValue(" move.w d0,d1");
        expect(value).not.toContain("Assembled as");
        expect(value).toContain("move[.(bwl)] <source>,<destination>");
        expect(value).not.toContain("CCR");
        expect(value).not.toContain("USP");
      });

      it("shows the general EORI page for a memory destination", async () => {
        const value = await hoverValue(" eori.w #5,(a0)");
        expect(value).not.toContain("Assembled as");
        expect(value).not.toContain("status register");
        expect(value).toContain("| - | * | * | 0 | 0 |");
      });

      it("keeps every form when an operand is not known", async () => {
        const value = await hoverValue("Set macro\n move.w \\1,\\2\n endm", 1);
        expect(value).toContain("move[.w] <source>,CCR");
        expect(value).toContain("move[.l] USP,An");
      });

      it("keeps the generic instruction for an immediate to a data register", async () => {
        const value = await hoverValue(" add.w #5,d0");
        expect(value).not.toContain("Assembled as");
        expect(value).toContain("add[.(bwl)] <source>,<destination>");
      });

      it("reads a register alias as the register it names", async () => {
        const value = await hoverValue("ptr equr a2\n add.l #4,ptr");
        expect(value.startsWith("Assembled as **ADDA**\n")).toBe(true);
      });

      it("does not take a data register alias for memory", async () => {
        const value = await hoverValue("count equr d3\n add.w #1,count");
        expect(value).not.toContain("Assembled as");
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
      const onPrefix = await provider.onHover({
        textDocument,
        position: lsp.Position.create(0, 6),
      });
      expect(onPrefix).toEqual({
        range: range(0, 6, 0, 9),
        contents: hover?.contents,
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

      it.each([
        [
          "\tbra\tElsewhere",
          "Reads possibly any · Modifies possibly D0–D1/A0–A1",
        ],
        [
          "\tjmp\t(a0)",
          "Reads A0 and possibly others · Modifies possibly D0–D1/A0–A1",
        ],
      ])(
        "applies the caller's save to a callee that jumps somewhere unknown (%j)",
        async (exit, expected) => {
          expect(
            await summaryOf(`InitTables:
\tmovem.l\td2-d7/a2-a6,-(sp)
\tbsr\tInitMap
\tmovem.l\t(sp)+,d2-d7/a2-a6
\trts
InitMap:
\tmoveq\t#1,d3
${exit}`),
          ).toBe(expected);
        },
      );

      it.each([
        // Everything the call could change is saved around it.
        ["d0-a6", "", "Reads A6 and possibly others"],
        // Only the registers the save leaves out may be changed.
        [
          "d2-d7/a2-a6",
          "",
          "Reads A6 and possibly others · Modifies possibly D0–D1/A0–A1",
        ],
        [
          "d2-d7/a2-a6",
          "\tmoveq\t#0,d0\n",
          "Reads A6 and possibly others · Modifies D0 and possibly D1/A0–A1",
        ],
      ])(
        "leaves what a save around unanalysed code restores out of what it may modify (%s)",
        async (list, after, expected) => {
          expect(
            await summaryOf(`Library:
\tmovem.l\t${list},-(sp)
\tjsr\t(a6)
\tmovem.l\t(sp)+,${list}
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

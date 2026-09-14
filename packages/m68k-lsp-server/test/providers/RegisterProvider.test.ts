import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import RegisterProvider from "../../src/providers/RegisterProvider";
import { createTestContext, range } from "../helpers";

describe("RegisterProvider", () => {
  let provider: RegisterProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new RegisterProvider(ctx);
  });

  // Create and process text doc
  const createDoc = async (filename: string, text: string) => {
    const uri = ctx.workspaceFolders[0].uri + "/" + filename;
    const textDocument = TextDocument.create(uri, "vasmmot", 0, text);
    await processor.process(textDocument);
    return textDocument;
  };

  describe("#register()", () => {
    it("registers custom requests", () => {
      const conn = {
        onRequest: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "m68k/registerRanges" }),
        expect.any(Function),
      );
      expect(conn.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "m68k/registerUsage" }),
        expect.any(Function),
      );
      expect(conn.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "m68k/registerSwap" }),
        expect.any(Function),
      );
      expect(conn.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "m68k/registerRemap" }),
        expect.any(Function),
      );
      expect(conn.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "m68k/routineRange" }),
        expect.any(Function),
      );
      expect(capabilities).toEqual({});
    });
  });

  describe("#onRegisterUsage()", () => {
    it("returns canonical register references within the requested range", async () => {
      const textDocument = await createDoc(
        "usage.s",
        ` move D0,d1
 move (sp),d2
 move d3,d4
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 2, 0),
      });

      expect(result).toEqual({
        documentVersion: 0,
        registers: [
          {
            name: "d0",
            firstUse: { line: 0, character: 6 },
            references: [
              {
                range: range(0, 6, 0, 8),
                spelling: "D0",
                kind: "explicit",
                access: "read",
              },
            ],
            read: true,
            written: false,
            input: true,
          },
          {
            name: "d1",
            firstUse: { line: 0, character: 9 },
            references: [
              {
                range: range(0, 9, 0, 11),
                spelling: "d1",
                kind: "explicit",
                access: "write",
              },
            ],
            read: false,
            written: true,
            input: false,
          },
          {
            name: "a7",
            firstUse: { line: 1, character: 7 },
            references: [
              {
                range: range(1, 7, 1, 9),
                spelling: "sp",
                kind: "explicit",
                access: "read",
              },
            ],
            read: true,
            written: false,
            input: true,
          },
          {
            name: "d2",
            firstUse: { line: 1, character: 11 },
            references: [
              {
                range: range(1, 11, 1, 13),
                spelling: "d2",
                kind: "explicit",
                access: "write",
              },
            ],
            read: false,
            written: true,
            input: false,
          },
        ],
      });
    });

    it("expands register lists while preserving their source range", async () => {
      const textDocument = await createDoc(
        "register-list.s",
        " movem.l d0-d2/a1,-(sp)\n",
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 1, 0),
      });

      expect(result?.registers.map(({ name }) => name)).toEqual([
        "d0",
        "d1",
        "d2",
        "a1",
        "a7",
      ]);
      expect(result?.registers[0].references).toEqual([
        {
          range: range(0, 9, 0, 17),
          spelling: "d0-d2/a1",
          kind: "register-list",
          access: "read",
        },
      ]);
    });

    it("classifies direct and addressing-mode register access", async () => {
      const textDocument = await createDoc(
        "access.s",
        ` move.w d0,d1
 add.w d2,d1
 cmp.w d3,d1
 clr.w d4
 move.w (a0)+,d5
 movem.w (a1)+,d6-d7
 mystery d0
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 7, 0),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")?.references.map(({ access }) => access)).toEqual([
        "read",
        "unknown",
      ]);
      expect(byName.get("d1")?.references.map(({ access }) => access)).toEqual([
        "write",
        "readwrite",
        "read",
      ]);
      expect(byName.get("d4")?.references[0].access).toBe("write");
      expect(byName.get("a0")?.references[0].access).toBe("readwrite");
      expect(byName.get("a1")?.references[0].access).toBe("readwrite");
      expect(byName.get("d6")?.references[0].access).toBe("write");
      expect(byName.get("d7")?.references[0].access).toBe("write");
    });

    it("marks registers available when they are untouched after the cursor line", async () => {
      const textDocument = await createDoc(
        "available.s",
        `Start:
 move.w d0,d1
 move.w d2,d3
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 4),
        position: lsp.Position.create(1, 5),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")?.availability).toBe("available");
      expect(byName.get("d1")?.availability).toBe("available");
      expect(byName.get("d2")?.availability).toBe("unavailable");
      expect(byName.get("d3")?.availability).toBe("unavailable");
    });

    it("ignores register accesses skipped by an unconditional branch", async () => {
      const textDocument = await createDoc(
        "available-branch.s",
        `Start:
 move.w d0,d1
 bra Done
 move.w d0,d1
Done:
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 5, 4),
        position: lsp.Position.create(1, 5),
      });

      expect(
        result?.registers.find(({ name }) => name === "d0")?.availability,
      ).toBe("available");
      expect(
        result?.registers.find(({ name }) => name === "d1")?.availability,
      ).toBe("available");
    });

    it("keeps code after BRA reachable through a conditional branch", async () => {
      const textDocument = await createDoc(
        "conditional-around-branch.s",
        `Start:
 move.w d0,d1
 beq .afterBra
 bra .done
.afterBra:
 move.w d0,d1
.done:
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 7, 4),
        position: lsp.Position.create(1, 5),
      });

      expect(
        result?.registers.find(({ name }) => name === "d0")?.availability,
      ).toBe("unavailable");
      expect(
        result?.registers.find(({ name }) => name === "d1")?.availability,
      ).toBe("unavailable");
    });

    it("follows a backward conditional branch that revisits the cursor line", async () => {
      const textDocument = await createDoc(
        "unavailable-loop.s",
        `Start:
 move.w d0,d1
 addq.w #1,d2
 bne Start
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 4, 4),
        position: lsp.Position.create(1, 5),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")?.availability).toBe("unavailable");
      expect(byName.get("d1")?.availability).toBe("unavailable");
      expect(byName.get("d2")?.availability).toBe("unavailable");
    });

    it("is conservative when a branch target cannot be resolved", async () => {
      const textDocument = await createDoc(
        "unresolved-loop.s",
        `Start:
 move.w d0,d1
 bne *-2
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 4),
        position: lsp.Position.create(1, 5),
      });

      expect(
        result?.registers.every(
          ({ availability }) => availability === "unavailable",
        ),
      ).toBe(true);
    });

    it("marks untouched registers unknown across a reachable subroutine call", async () => {
      const textDocument = await createDoc(
        "unknown-call.s",
        `Start:
 move.w d0,d1
 jsr (a0)
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 4),
        position: lsp.Position.create(1, 5),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")?.availability).toBe("unknown");
      expect(byName.get("d1")?.availability).toBe("unknown");
      expect(byName.get("a0")?.availability).toBe("unavailable");
    });

    it("follows a known subroutine and preserves untouched availability", async () => {
      const textDocument = await createDoc(
        "known-call.s",
        `Start:
 move.w d0,d1
 bsr Helper
 rts
Helper:
 move.w d2,d3
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 4),
        position: lsp.Position.create(1, 5),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")?.availability).toBe("available");
      expect(byName.get("d1")?.availability).toBe("available");
    });

    it("combines register touches across multiple callee return paths", async () => {
      const textDocument = await createDoc(
        "multiple-call-returns.s",
        `Start:
 move.w d0,d1
 bsr Helper
 rts
Helper:
 beq .preserved
 move.w d0,d2
 rts
.preserved:
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 4),
        position: lsp.Position.create(1, 5),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")?.availability).toBe("unavailable");
      expect(byName.get("d1")?.availability).toBe("available");
    });

    it("terminates recursive call traversal and keeps later touches", async () => {
      const textDocument = await createDoc(
        "recursive-call.s",
        `Start:
 move.w d0,d1
 bsr Helper
 rts
Helper:
 bsr Helper
 move.w d0,d2
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 4),
        position: lsp.Position.create(1, 5),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")?.availability).toBe("unavailable");
      expect(byName.get("d1")?.availability).toBe("available");
    });

    it("ignores a subroutine call skipped by an unconditional branch", async () => {
      const textDocument = await createDoc(
        "skipped-call.s",
        `Start:
 move.w d0,d1
 bra .done
 bsr Helper
.done:
 rts
Helper:
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 7, 4),
        position: lsp.Position.create(1, 5),
      });

      expect(
        result?.registers.find(({ name }) => name === "d0")?.availability,
      ).toBe("available");
      expect(
        result?.registers.find(({ name }) => name === "d1")?.availability,
      ).toBe("available");
    });

    it("expands textual macro parameters and reparses generated registers", async () => {
      const textDocument = await createDoc(
        "macro-usage.s",
        `Paint macro
 move.w d\\1,d2
 add.w d3,d\\1
 endm
 Paint 4
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(4, 0, 5, 0),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d4")?.references).toEqual([
        {
          range: range(4, 7, 4, 8),
          spelling: "d4",
          kind: "macro-expansion",
          access: "read",
        },
        {
          range: range(4, 7, 4, 8),
          spelling: "d4",
          kind: "macro-expansion",
          access: "readwrite",
        },
      ]);
      expect(byName.get("d2")?.references[0]).toEqual({
        range: range(4, 1, 4, 6),
        spelling: "d2",
        kind: "macro-expansion",
        access: "write",
      });
      expect(byName.get("d3")?.references[0].access).toBe("read");
    });

    it("preserves argument provenance through nested macro calls", async () => {
      const textDocument = await createDoc(
        "nested-macro.s",
        `Inner macro
 move.w d\\1,d0
 endm
Outer macro
 Inner \\1
 endm
 Outer 5
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(6, 0, 7, 0),
      });
      const d5 = result?.registers.find(({ name }) => name === "d5");

      expect(d5?.references).toEqual([
        {
          range: range(6, 7, 6, 8),
          spelling: "d5",
          kind: "macro-expansion",
          access: "read",
        },
      ]);
    });

    it("does not execute nested calls when selecting a macro definition", async () => {
      const textDocument = await createDoc(
        "macro-definition.s",
        `Inner macro
 move.w d6,d0
 endm
Outer macro
 Inner
 endm
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(3, 0, 6, 0),
      });

      expect(result?.registers).toEqual([]);
    });

    it("classifies direct register arguments from their expanded use only", async () => {
      const textDocument = await createDoc(
        "register-argument.s",
        `Copy macro
 move.w \\1,d0
 endm
 Copy d5
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(3, 0, 4, 0),
      });
      const d5 = result?.registers.find(({ name }) => name === "d5");

      expect(d5).toMatchObject({ read: true, written: false, input: true });
      expect(d5?.references).toEqual([
        {
          range: range(3, 6, 3, 8),
          spelling: "d5",
          kind: "explicit",
          access: "read",
        },
      ]);
    });

    it("expands arguments 10 through 35 using letter parameters", async () => {
      const arguments_ = Array.from({ length: 35 }, (_, index) =>
        index === 9 ? "3" : index === 34 ? "4" : "0",
      ).join(",");
      const textDocument = await createDoc(
        "extended-arguments.s",
        `Extended macro
 move.w d\\a,d\\z
 endm
 Extended ${arguments_}
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(3, 0, 4, 0),
      });

      expect(result?.registers.map(({ name }) => name)).toEqual(["d3", "d4"]);
      expect(result?.registers[0]).toMatchObject({
        read: true,
        written: false,
        input: true,
      });
      expect(result?.registers[1]).toMatchObject({
        read: false,
        written: true,
        input: false,
      });
    });

    it("expands NARG and the argument-count parameter", async () => {
      const textDocument = await createDoc(
        "narg.s",
        `Use macro
 move.w d\\1,d0
 endm
Count macro
 Use NARG
 move.w d0,d\\#
 endm
 Count x,y,z
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(7, 0, 8, 0),
      });
      const d3 = result?.registers.find(({ name }) => name === "d3");

      expect(d3?.references.map(({ access }) => access)).toEqual([
        "read",
        "write",
      ]);
    });

    it("expands qualifier and argument-length parameters", async () => {
      const textDocument = await createDoc(
        "qualifier-query.s",
        `Meta macro
 move.w d\\0,d\\?1
 endm
 Meta.5 abc
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(3, 0, 4, 0),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d5")?.references[0]).toMatchObject({
        range: range(3, 6, 3, 7),
        spelling: "d5",
        access: "read",
      });
      expect(byName.get("d3")?.references[0]).toMatchObject({
        spelling: "d3",
        access: "write",
      });
    });

    it("tracks CARG selectors and mutation across a macro body", async () => {
      const textDocument = await createDoc(
        "carg.s",
        `Use macro
 move.w d\\1,d0
 endm
Select macro
 move.w d\\.,d0
 move.w d\\+,d0
 Use CARG
 move.w d\\.,d0
 move.w d\\-,d0
 move.w d\\.,d0
 endm
 Select 2,3
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(11, 0, 12, 0),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d2")?.references).toHaveLength(4);
      expect(byName.get("d3")?.references).toHaveLength(2);
    });

    it("resolves macro definitions from included unit documents", async () => {
      const macroDocument = await createDoc(
        "macros.i",
        `Paint macro
 move.w d\\1,d0
 endm
`,
      );
      const textDocument = await createDoc("macro-caller.s", " Paint 6\n");
      ctx.store.get(textDocument.uri)!.referencedUris.push(macroDocument.uri);

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 1, 0),
      });

      expect(result?.registers.map(({ name }) => name)).toEqual(["d6", "d0"]);
    });

    it("stops recursive macro expansion", async () => {
      const textDocument = await createDoc(
        "recursive-macro.s",
        `Forever macro
 Forever \\1
 endm
 Forever 1
`,
      );

      expect(
        provider.onRegisterUsage({
          textDocument,
          range: range(3, 0, 4, 0),
        }),
      ).toEqual({ documentVersion: 0, registers: [], incomplete: true });
    });

    it("returns undefined for a document without a syntax tree", () => {
      expect(
        provider.onRegisterUsage({
          textDocument: { uri: "file:///missing.s" },
          range: range(0, 0, 1, 0),
        }),
      ).toBeUndefined();
    });
  });

  describe("#onRegisterSwap()", () => {
    it("plans both directions atomically and preserves token case", async () => {
      const textDocument = await createDoc(
        "swap.s",
        ` move.w D0,d1
 add.w d1,D0
`,
      );

      const result = provider.onRegisterSwap({
        textDocument,
        documentVersion: 0,
        range: range(0, 0, 2, 0),
        registers: ["d0", "d1"],
      });

      expect(result).toEqual({
        documentVersion: 0,
        edits: [
          { range: range(0, 8, 0, 10), newText: "D1" },
          { range: range(1, 10, 1, 12), newText: "D1" },
          { range: range(0, 11, 0, 13), newText: "d0" },
          { range: range(1, 7, 1, 9), newText: "d0" },
        ],
      });
    });

    it("treats SP as A7 when swapping address registers", async () => {
      const textDocument = await createDoc("swap-sp.s", " move SP,a0\n");

      const result = provider.onRegisterSwap({
        textDocument,
        documentVersion: 0,
        range: range(0, 0, 1, 0),
        registers: ["a7", "a0"],
      });

      expect(result?.edits).toEqual([
        { range: range(0, 6, 0, 8), newText: "A0" },
        { range: range(0, 9, 0, 11), newText: "a7" },
      ]);
    });

    it("allows an unused destination register", async () => {
      const textDocument = await createDoc(
        "unused-swap.s",
        " move d0,d1\n add d0,d1\n",
      );

      const result = provider.onRegisterSwap({
        textDocument,
        documentVersion: 0,
        range: range(0, 0, 2, 0),
        registers: ["d0", "d2"],
      });

      expect(result).toEqual({
        documentVersion: 0,
        edits: [
          { range: range(0, 6, 0, 8), newText: "d2" },
          { range: range(1, 5, 1, 7), newText: "d2" },
        ],
      });
    });

    it("rejects stale document versions", async () => {
      const textDocument = await createDoc("stale-swap.s", " move d0,d1\n");

      expect(
        provider.onRegisterSwap({
          textDocument,
          documentVersion: 1,
          range: range(0, 0, 1, 0),
          registers: ["d0", "d1"],
        }),
      ).toMatchObject({ edits: [], error: "stale-document" });
    });

    it("rejects identical or invalid registers", async () => {
      const textDocument = await createDoc("invalid-swap.s", " move d0,d1\n");

      expect(
        provider.onRegisterSwap({
          textDocument,
          documentVersion: 0,
          range: range(0, 0, 1, 0),
          registers: ["d0", "d0"],
        }),
      ).toMatchObject({ edits: [], error: "invalid-registers" });
    });

    it("returns no partial edits for register lists", async () => {
      const textDocument = await createDoc(
        "list-swap.s",
        " movem.l d0-d1,-(sp)\n",
      );

      const result = provider.onRegisterSwap({
        textDocument,
        documentVersion: 0,
        range: range(0, 0, 1, 0),
        registers: ["d0", "d1"],
      });

      expect(result).toMatchObject({
        edits: [],
        error: "unsupported-reference",
      });
      expect(result?.unsupported).toHaveLength(2);
    });

    it("returns no partial edits for macro-generated references", async () => {
      const textDocument = await createDoc(
        "macro-swap.s",
        `Copy macro
 move.w d\\1,d0
 endm
 Copy 1
`,
      );

      const result = provider.onRegisterSwap({
        textDocument,
        documentVersion: 0,
        range: range(3, 0, 4, 0),
        registers: ["d0", "d1"],
      });

      expect(result).toMatchObject({
        edits: [],
        error: "unsupported-reference",
      });
      expect(result?.unsupported).toHaveLength(2);
    });
  });

  describe("#onRoutineRange()", () => {
    it("returns the previous non-local label through the next RTS", async () => {
      const textDocument = await createDoc(
        "routine.s",
        `First:
 moveq #1,d0
 rts

Second:
 moveq #2,d1
.loop:
 addq #1,d1
 rts
`,
      );

      expect(
        provider.onRoutineRange({
          textDocument,
          position: lsp.Position.create(7, 4),
        }),
      ).toEqual({
        range: range(4, 0, 8, 4),
        label: "Second",
      });
    });

    it("uses the start of the file before the first non-local label", async () => {
      const textDocument = await createDoc(
        "no-label.s",
        " moveq #1,d0\n rts\n",
      );

      expect(
        provider.onRoutineRange({
          textDocument,
          position: lsp.Position.create(0, 2),
        }),
      ).toEqual({
        range: range(0, 0, 1, 4),
        label: "Start of file",
      });
    });

    it("includes preamble code through the first routine RTS", async () => {
      const textDocument = await createDoc(
        "preamble-label.s",
        ` moveq #1,d0
Start:
 moveq #2,d1
 rts
`,
      );

      const scope = provider.onRoutineRange({
        textDocument,
        position: lsp.Position.create(0, 2),
      });

      expect(scope).toEqual({
        range: range(0, 0, 3, 4),
        label: "Start of file",
      });
      const usage = provider.onRegisterUsage({
        textDocument,
        range: scope!.range,
      });
      expect(usage?.registers.map(({ name }) => name)).toEqual(["d0", "d1"]);
    });

    it("does not treat an RS offset definition as a code label", async () => {
      const textDocument = await createDoc(
        "offset-definition.s",
        `Tr_SIZEOF       rs.w    0
                move.w d0,d1
`,
      );

      const scope = provider.onRoutineRange({
        textDocument,
        position: lsp.Position.create(1, 20),
      });

      expect(scope).toEqual({
        range: range(0, 0, 2, 0),
        label: "Start of file",
      });
      const usage = provider.onRegisterUsage({
        textDocument,
        range: scope!.range,
      });
      expect(usage?.registers.map(({ name }) => name)).toEqual(["d0", "d1"]);
    });

    it("continues through the end of the file without a return", async () => {
      const textDocument = await createDoc(
        "no-rts.s",
        `Start:
 moveq #1,d0
Tail:
 moveq #2,d1
`,
      );

      const scope = provider.onRoutineRange({
        textDocument,
        position: lsp.Position.create(1, 2),
      });

      expect(scope).toEqual({
        range: range(0, 0, 4, 0),
        label: "Start",
      });
      const usage = provider.onRegisterUsage({
        textDocument,
        range: scope!.range,
      });
      expect(usage?.registers.map(({ name }) => name)).toEqual(["d0", "d1"]);
    });

    it("falls through later labeled regions until a return", async () => {
      const textDocument = await createDoc(
        "next-routine.s",
        `First:
 moveq #1,d0
Second:
 moveq #2,d1
 rts
`,
      );

      const scope = provider.onRoutineRange({
        textDocument,
        position: lsp.Position.create(1, 2),
      });

      expect(scope).toEqual({
        range: range(0, 0, 4, 4),
        label: "First",
      });
      const usage = provider.onRegisterUsage({
        textDocument,
        range: scope!.range,
      });
      expect(usage?.registers.map(({ name }) => name)).toEqual(["d0", "d1"]);
    });

    it.each(["rte", "rtr"])("ends an inferred scope at %s", async (return_) => {
      const textDocument = await createDoc(
        `routine-${return_}.s`,
        `Handler:
 moveq #1,d0
 ${return_}
`,
      );

      expect(
        provider.onRoutineRange({
          textDocument,
          position: lsp.Position.create(1, 2),
        }),
      ).toEqual({
        range: range(0, 0, 2, 4),
        label: "Handler",
      });
    });
  });

  describe("incomplete macro analysis", () => {
    const cases = [
      [
        "line limit",
        "Use macro\n move \\1,d7\n" +
          " nop\n".repeat(999) +
          " move d0,d6\n endm\n",
      ],
      ["recursion", "Use macro\n move \\1,d7\n Use \\1\n endm\n"],
      [
        "depth limit",
        Array.from(
          { length: 11 },
          (_, i) =>
            `${i === 0 ? "Use" : `Nested${i}`} macro\n${i < 10 ? ` Nested${i + 1} \\1` : " move d0,d6"}\n endm\n`,
        ).join(""),
      ],
    ];
    it.each(cases)(
      "rejects remapping and swapping after reaching the %s",
      async (name, definitions) => {
        const callLine = definitions.split("\n").length - 1;
        const textDocument = await createDoc(
          `${name}.s`,
          definitions + " Use d0\n move d0,d1\n",
        );
        const params = {
          textDocument,
          documentVersion: 0,
          range: range(callLine, 0, callLine + 2, 0),
        };
        expect(provider.onRegisterUsage(params)?.incomplete).toBe(true);
        expect(
          provider.onRegisterRemap({ ...params, mappings: { d0: "d2" } }),
        ).toMatchObject({
          edits: [],
          error: "analysis-incomplete",
        });
        expect(
          provider.onRegisterSwap({ ...params, registers: ["d0", "d2"] }),
        ).toMatchObject({
          edits: [],
          error: "analysis-incomplete",
        });
      },
    );

    it("allows a macro that finishes exactly at the line limit", async () => {
      const definitions =
        "Use macro\n move \\1,d7\n" + " nop\n".repeat(999) + " endm\n";
      const callLine = definitions.split("\n").length - 1;
      const textDocument = await createDoc(
        "exact-limit.s",
        definitions + " Use d0\n",
      );
      const params = {
        textDocument,
        documentVersion: 0,
        range: range(callLine, 0, callLine + 1, 0),
      };
      expect(provider.onRegisterUsage(params)?.incomplete).toBeUndefined();
      expect(
        provider.onRegisterRemap({ ...params, mappings: { d0: "d2" } }),
      ).toEqual({
        documentVersion: 0,
        warnings: [expect.stringContaining("D0 is an input register")],
        edits: [{ range: range(callLine, 5, callLine, 7), newText: "d2" }],
      });
    });
  });

  describe("#onRegisterRemap()", () => {
    it.each([
      ["unknown macro", " UnknownMacro d0\n moveq #1,d0\n", 0],
      [
        "fixed macro reference",
        "Use macro\n move.l d0,d1\n endm\n Use\n moveq #1,d0\n",
        3,
      ],
      ["recursive macro", "Use macro\n Use\n endm\n Use\n moveq #1,d0\n", 3],
    ])(
      "validates explicit instructions alongside %s",
      async (label, source, start) => {
        const textDocument = await createDoc(`${label}.s`, source);
        const result = provider.onRegisterRemap({
          textDocument,
          documentVersion: 0,
          range: range(start, 0, source.split("\n").length, 0),
          mappings: { d0: "a0" },
        });
        expect(result?.warnings?.some((w) => w.includes("MOVEQ"))).toBe(true);
        if (label !== "unknown macro") {
          expect(result?.validationIncomplete).toBe(true);
          expect(result?.edits).toEqual([]);
        }
      },
    );

    it("returns invalid-code warnings without withholding edits", async () => {
      const textDocument = await createDoc("invalid-remap.s", " moveq #1,d0\n");
      const result = provider.onRegisterRemap({
        textDocument,
        documentVersion: 0,
        range: range(0, 0, 1, 0),
        mappings: { d0: "a0" },
      });
      expect(result?.error).toBeUndefined();
      expect(result?.warnings?.[0]).toContain("MOVEQ operands do not match");
      expect(result?.edits).toHaveLength(1);
      expect(result?.edits[0].newText).toBe("a0");
    });

    it.each([
      [" moveq #1,d0\n", false],
      [" addq #1,d0\n", true],
    ])(
      "warns only for inputs in the selected scope: %s",
      async (instruction, input) => {
        const textDocument = await createDoc(
          "input-remap.s",
          " moveq #0,d0\n" + instruction,
        );
        const result = provider.onRegisterRemap({
          textDocument,
          documentVersion: 0,
          range: range(1, 0, 2, 0),
          mappings: { d0: "d1" },
        });
        expect(result?.error).toBeUndefined();
        expect(result?.edits).toHaveLength(1);
        if (input) {
          expect(result?.warnings).toEqual([
            "Line 2: D0 is an input register. Remapping it to D1 requires updating the code outside this scope that supplies its value.",
          ]);
        } else {
          expect(result?.warnings).toBeUndefined();
        }
      },
    );

    it("plans multiple mappings against the original source", async () => {
      const textDocument = await createDoc(
        "remap.s",
        " move d0,d1\n add d1,d2\n",
      );

      const result = provider.onRegisterRemap({
        textDocument,
        documentVersion: 0,
        range: range(0, 0, 2, 0),
        mappings: { d0: "d3", d1: "d0", d2: "d1" },
      });

      expect(result).toEqual({
        documentVersion: 0,
        warnings: [
          expect.stringContaining("D0 is an input register"),
          expect.stringContaining("D2 is an input register"),
        ],
        edits: [
          { range: range(0, 6, 0, 8), newText: "d3" },
          { range: range(0, 9, 0, 11), newText: "d0" },
          { range: range(1, 5, 1, 7), newText: "d0" },
          { range: range(1, 8, 1, 10), newText: "d1" },
        ],
      });
    });

    it("remaps literal macro arguments once, preserving case and aliases", async () => {
      const textDocument = await createDoc(
        "literal-remap.s",
        `Use macro
 move.l \\1,\\2
 add.l \\1,\\2
 endm
 Use D0,sp
`,
      );
      expect(
        provider.onRegisterRemap({
          textDocument,
          documentVersion: 0,
          range: range(4, 0, 5, 0),
          mappings: { d0: "d2", a7: "a3" },
        }),
      ).toEqual({
        documentVersion: 0,
        warnings: [expect.stringContaining("D0 is an input register")],
        edits: [
          { range: range(4, 5, 4, 7), newText: "D2" },
          { range: range(4, 8, 4, 10), newText: "a3" },
        ],
      });
    });

    it("remaps literal arguments forwarded through nested macros", async () => {
      const textDocument = await createDoc(
        "nested-literal-remap.s",
        `Inner macro
 move.l \\1,d7
 endm
Outer macro
 Inner \\1
 endm
 Outer d0
`,
      );
      expect(
        provider.onRegisterRemap({
          textDocument,
          documentVersion: 0,
          range: range(6, 0, 7, 0),
          mappings: { d0: "d2" },
        }),
      ).toEqual({
        documentVersion: 0,
        edits: [{ range: range(6, 7, 6, 9), newText: "d2" }],
      });
    });

    it.each(["d0", "\\1/d1"])(
      "rejects unsafe nested arguments: %s",
      async (argument) => {
        const textDocument = await createDoc(
          "unsafe-nested-remap.s",
          `Inner macro
 movem.l \\1,-(sp)
 endm
Outer macro
 Inner ${argument}
 endm
 Outer d0
`,
        );
        expect(
          provider.onRegisterRemap({
            textDocument,
            documentVersion: 0,
            range: range(6, 0, 7, 0),
            mappings: { d0: "d2", d1: "d3" },
          }),
        ).toMatchObject({ edits: [], error: "unsupported-reference" });
      },
    );

    it("returns no partial edits when a register is also fixed in the macro body", async () => {
      const textDocument = await createDoc(
        "mixed-remap.s",
        `Use macro
 move.l \\1,d0
 endm
 Use d0
`,
      );
      expect(
        provider.onRegisterRemap({
          textDocument,
          documentVersion: 0,
          range: range(3, 0, 4, 0),
          mappings: { d0: "d2" },
        }),
      ).toMatchObject({ edits: [], error: "unsupported-reference" });
    });

    it("rejects unsupported mapped references", async () => {
      const textDocument = await createDoc(
        "macro-remap.s",
        `Copy macro
 move d\\1,d0
 endm
 Copy 1
`,
      );

      expect(
        provider.onRegisterRemap({
          textDocument,
          documentVersion: 0,
          range: range(3, 0, 4, 0),
          mappings: { d1: "d2" },
        }),
      ).toMatchObject({ edits: [], error: "unsupported-reference" });
    });
  });
});

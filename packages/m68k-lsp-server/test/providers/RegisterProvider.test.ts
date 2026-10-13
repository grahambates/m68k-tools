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
        expect.objectContaining({ method: "m68k/blockRange" }),
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
            lastUse: { line: 0, character: 6 },
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
            lastUse: { line: 0, character: 9 },
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
            lastUse: { line: 1, character: 7 },
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
            lastUse: { line: 1, character: 11 },
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

    it("reports the first and last use within the range", async () => {
      const textDocument = await createDoc(
        "use-range.s",
        ` moveq #0,d0
 move.l d1,d2
 add.l d0,d1
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 0),
      });

      expect(result?.registers.find(({ name }) => name === "d0")).toMatchObject(
        {
          firstUse: { line: 0, character: 10 },
          lastUse: { line: 2, character: 7 },
        },
      );
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
      // Only written afterwards, and nothing reads the word it keeps.
      expect(byName.get("d3")).toMatchObject({
        availability: "available",
        availableUntilOverwritten: true,
      });
    });

    it("marks documented outputs and never reports them available", async () => {
      const textDocument = await createDoc(
        "outputs.s",
        `; Outputs: d1 = total
Start:
 move.w d0,d1
 move.w d2,d3
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(1, 0, 4, 4),
        position: lsp.Position.create(2, 5),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d0")).toMatchObject({ availability: "available" });
      expect(byName.get("d0")?.output).toBeUndefined();
      expect(byName.get("d1")).toMatchObject({
        output: true,
        availability: "unavailable",
      });
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
      // Only written by the later MOVE.W, which nothing reads.
      expect(
        result?.registers.find(({ name }) => name === "d1")?.availability,
      ).toBe("available");
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
      // Rewritten by the MOVE.W the loop returns to, and never read.
      expect(byName.get("d1")?.availability).toBe("available");
      expect(byName.get("d2")?.availability).toBe("unavailable");
    });

    it.each(["dbf d7,.loop", "bne.s .loop", "bra.s .loop"])(
      "keeps registers a loop carries over unavailable with the cursor on %s",
      async (branch) => {
        const textDocument = await createDoc(
          "loop-branch.s",
          `Start:
 moveq #7,d7
.loop:
 move.w (a0)+,d0
 add.w d0,d1
 ${branch}
 rts
`,
        );

        const result = provider.onRegisterUsage({
          textDocument,
          range: range(0, 0, 6, 4),
          position: lsp.Position.create(5, 2),
        });
        const byName = new Map(
          result?.registers.map((usage) => [usage.name, usage]),
        );

        // The pointer and the total carry over between iterations.
        for (const register of ["a0", "d1"]) {
          expect(byName.get(register)?.availability).toBe("unavailable");
        }
        // Each iteration reloads the word of D0 it reads.
        expect(byName.get("d0")?.availability).toBe("available");
      },
    );

    describe("liveness", () => {
      const availability = async (text: string, line: number) => {
        const textDocument = await createDoc("liveness.s", text);
        const lines = text.split("\n").length;
        const result = provider.onRegisterUsage({
          textDocument,
          range: range(0, 0, lines, 0),
          position: lsp.Position.create(line, 1),
        });
        return Object.fromEntries(
          result?.registers.map(({ name, availability }) => [
            name,
            availability,
          ]) ?? [],
        );
      };

      it("frees a register overwritten before it is read again", async () => {
        expect(
          await availability(
            `Start:
 move.w d2,d1
 moveq #0,d2
 add.w d2,d1
 rts`,
            1,
          ),
        ).toMatchObject({ d1: "unavailable", d2: "available" });
      });

      it.each([
        ["move.w #1,d2", "add.w d2,d1", "available"],
        ["move.w #1,d2", "add.l d2,d1", "unavailable"],
        ["move.b #1,d2", "add.w d2,d1", "unavailable"],
        ["moveq #1,d2", "add.l d2,d1", "available"],
        ["move.w #1,d2", "move.w (a0,d2.w),d1", "available"],
        ["move.w #1,d2", "move.w (a0,d2),d1", "available"],
        ["move.w #1,d2", "move.w (a0,d2.l),d1", "unavailable"],
        ["move.w #1,d2", "divu.w #3,d2", "unavailable"],
        ["move.w #1,d2", "mulu.w #3,d2", "available"],
      ])(
        "compares the bits written with those read: %s then %s",
        async (write, read, expected) => {
          // Lines before the first use, at the start of the block.
          expect(
            (
              await availability(
                `Start:
 nop
 ${write}
 ${read}
 rts`,
                0,
              )
            ).d2,
          ).toBe(expected);
        },
      );

      it.each([
        ["move.l #0,d2", "available"],
        ["clr.l d2", "available"],
        ["move.w #0,d2", "unavailable"],
        ["move.b (a0),d2", "unavailable"],
        ["st d2", "unavailable"],
      ])(
        "treats %s as overwriting the register: %s",
        async (write, expected) => {
          expect(
            (
              await availability(
                `Start:
 nop
 ${write}
 add.l d2,d1
 rts`,
                1,
              )
            ).d2,
          ).toBe(expected);
        },
      );

      it("treats any address register write as a whole overwrite", async () => {
        expect(
          (
            await availability(
              `Start:
 nop
 movea.w #0,a1
 move.l a1,d0
 rts`,
              1,
            )
          ).a1,
        ).toBe("available");
      });

      it("does not count a conditional write as an overwrite", async () => {
        for (const write of [
          " iif DEBUG moveq #0,d2",
          " ifd DEBUG\n moveq #0,d2\n endc",
        ]) {
          expect(
            (
              await availability(
                `Start:
 nop
${write}
 add.l d2,d1
 rts`,
                1,
              )
            ).d2,
          ).toBe("unavailable");
        }
      });

      it("follows the order of a macro's expanded lines", async () => {
        const macros = `Clear macro
 moveq #0,\\1
 endm
Accumulate macro
 add.l \\1,d1
 moveq #0,\\1
 endm
`;
        expect(
          (
            await availability(
              macros +
                `Start:
 nop
 Clear d2
 add.l d2,d1
 rts`,
              8,
            )
          ).d2,
        ).toBe("available");
        expect(
          (
            await availability(
              macros +
                `Start:
 nop
 Accumulate d2
 add.l d2,d1
 rts`,
              8,
            )
          ).d2,
        ).toBe("unavailable");
      });

      it("frees a register each loop iteration overwrites first", async () => {
        expect(
          await availability(
            `Start:
 moveq #7,d7
.loop:
 moveq #0,d2
 add.l d2,d1
 dbf d7,.loop
 rts`,
            5,
          ),
        ).toMatchObject({
          d1: "unavailable",
          d2: "available",
          d7: "unavailable",
        });
      });

      const usageAt = async (text: string, line: number) => {
        const textDocument = await createDoc("liveness.s", text);
        const result = provider.onRegisterUsage({
          textDocument,
          range: range(0, 0, text.split("\n").length, 0),
          position: lsp.Position.create(line, 1),
        });
        return new Map(result?.registers.map((usage) => [usage.name, usage]));
      };

      it("reports where in the scope a register is free", async () => {
        const usage = await usageAt(
          `Start:
 move.l d2,d3
 nop
 nop
 moveq #0,d2
 add.l d2,d1
 rts`,
          1,
        );

        expect(usage.get("d2")).toMatchObject({
          availability: "available",
          availableUntilOverwritten: true,
          availabilityRanges: [
            {
              range: range(2, 0, 3, 0),
              availability: "available",
              untilOverwritten: true,
            },
            { range: range(6, 0, 6, 0), availability: "available" },
          ],
        });
        // Free on the label before its write too, but a run of nothing but a
        // label is left out.
        expect(usage.get("d3")).toMatchObject({
          availability: "available",
          availabilityRanges: [
            { range: range(2, 0, 6, 0), availability: "available" },
          ],
        });
        expect(usage.get("d3")?.availableUntilOverwritten).toBeUndefined();
        expect(usage.get("d1")).toMatchObject({
          availability: "unavailable",
          availabilityRanges: [
            { range: range(6, 0, 6, 0), availability: "available" },
          ],
        });
      });

      it("keeps a label inside a run that carries on past it", async () => {
        const usage = await usageAt(
          `Start:
 nop
.next:

 nop
.done:
 moveq #0,d2
 add.l d2,d1
 rts`,
          1,
        );

        expect(usage.get("d2")?.availabilityRanges).toEqual([
          {
            range: range(1, 0, 4, 0),
            availability: "available",
            untilOverwritten: true,
          },
          { range: range(8, 0, 8, 0), availability: "available" },
        ]);
      });

      it("reports runs that depend on unresolved code as unknown", async () => {
        const usage = await usageAt(
          `Start:
 nop
 jsr (a0)
 moveq #0,d2
 add.l d2,d1
 rts`,
          1,
        );

        expect(usage.get("d2")).toMatchObject({
          availability: "unknown",
          availabilityRanges: [
            { range: range(1, 0, 1, 0), availability: "unknown" },
            { range: range(5, 0, 5, 0), availability: "available" },
          ],
        });
      });

      it("finds free lines inside a loop as well as after it", async () => {
        const usage = await usageAt(
          `Start:
 moveq #7,d7
.loop:
 moveq #0,d2
 add.l d2,d1
 nop
 dbf d7,.loop
 rts`,
          1,
        );

        // Runs stop short of the labels at their edges.
        expect(usage.get("d2")?.availabilityRanges).toEqual([
          {
            range: range(1, 0, 1, 0),
            availability: "available",
            untilOverwritten: true,
          },
          {
            range: range(5, 0, 6, 0),
            availability: "available",
            untilOverwritten: true,
          },
          // After the loop nothing touches it again.
          { range: range(7, 0, 7, 0), availability: "available" },
        ]);
      });

      it("frees an output only when every return overwrites it", async () => {
        const source = (alternative: string) => `; Outputs: d0 = result
Start:
 move.l d0,d1
 tst.w d1
 beq.s .other
 moveq #1,d0
 rts
.other:
 ${alternative}
 rts`;

        expect(
          (await usageAt(source("moveq #2,d0"), 2)).get("d0"),
        ).toMatchObject({
          availability: "available",
          availableUntilOverwritten: true,
        });
        expect((await usageAt(source("nop"), 2)).get("d0")?.availability).toBe(
          "unavailable",
        );
      });

      it.each([
        // The callee reads it.
        [" add.l d2,d0\n rts", " nop", "unavailable"],
        // The callee keeps it, and the caller reads it afterwards.
        [" nop\n rts", " add.l d2,d1", "unavailable"],
        // The callee keeps it, and nothing reads it afterwards.
        [" nop\n rts", " nop", "available"],
        // The callee replaces only the word the caller reads.
        [" move.w #0,d2\n rts", " add.w d2,d1", "available"],
        // The callee replaces a word, but the caller reads all of it.
        [" move.w #0,d2\n rts", " add.l d2,d1", "unavailable"],
      ])(
        "follows the register through a call: %j then %j",
        async (callee, after, expected) => {
          expect(
            (
              await availability(
                `Start:
 move.l d2,d3
 bsr Helper
${after}
 rts
Helper:
${callee}`,
                1,
              )
            ).d2,
          ).toBe(expected);
        },
      );

      it("settles mutually recursive calls", async () => {
        const result = await availability(
          `Start:
 nop
 bsr Even
 rts
Even:
 tst.w d0
 beq.s .done
 subq.w #1,d0
 bsr Odd
.done:
 rts
Odd:
 moveq #0,d2
 tst.w d0
 beq.s .done
 subq.w #1,d0
 bsr Even
.done:
 rts`,
          1,
        );
        expect(result).toMatchObject({
          d0: "unavailable",
          // Odd overwrites it before anything reads it.
          d2: "available",
        });
      });

      it("takes a routine in another file at its header's word", async () => {
        const library = await createDoc(
          "library.i",
          `; Inputs: d0 = count
; Trashes: d2
Helper:
 rts
; Clears the screen
Undocumented:
 rts
`,
        );
        const source = (callee: string) => `Start:
 nop
 bsr ${callee}
 add.l d2,d1
 add.l d3,d1
 rts`;
        const caller = await createDoc("caller.s", source("Helper"));
        ctx.store.get(caller.uri)!.referencedUris.push(library.uri);

        const at = (textDocument: typeof caller) => {
          const result = provider.onRegisterUsage({
            textDocument,
            range: range(0, 0, 6, 0),
            position: lsp.Position.create(1, 1),
          });
          return Object.fromEntries(
            result?.registers.map(({ name, availability }) => [
              name,
              availability,
            ]) ?? [],
          );
        };
        expect(at(caller)).toMatchObject({
          // Trashed by the call before the caller reads it.
          d2: "available",
          // Not mentioned, so kept, and read after the call.
          d3: "unavailable",
        });

        // Without a documented contract the call may read anything, unless
        // the caller definitely reads the register afterwards anyway.
        const other = await createDoc(
          "other.s",
          `Start:
 move.l d2,d3
 bsr Undocumented
 add.l d3,d1
 rts`,
        );
        ctx.store.get(other.uri)!.referencedUris.push(library.uri);
        expect(at(other)).toMatchObject({ d2: "unknown", d3: "unavailable" });
      });

      it("follows a call through the subroutine", async () => {
        const result = await availability(
          `Start:
 move.l d2,d3
 bsr Helper
 rts
Helper:
 moveq #0,d2
 rts`,
          1,
        );
        // The callee overwrites D2 before anything reads it.
        expect(result).toMatchObject({ d2: "available", d3: "available" });
      });
    });

    it("frees registers only used past a return under the cursor", async () => {
      const textDocument = await createDoc(
        "early-return-availability.s",
        `Foo:
 tst.w d0
 bne.s .continue
 rts
.continue:
 move.w d2,d1
 rts
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 6, 4),
        position: lsp.Position.create(3, 2),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d1")?.availability).toBe("available");
      expect(byName.get("d2")?.availability).toBe("available");
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
 tst.w d3
 beq.s .done
 bsr Helper
.done:
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

    it("reads the synonym spellings of Scc as the instruction they stand for", async () => {
      const textDocument = await createDoc(
        "scc-synonyms.s",
        ` shs.b d0
 slo.b d1
 scc.b d2
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 3, 0),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      // Scc only writes its destination, however it is spelled.
      for (const name of ["d0", "d1", "d2"]) {
        expect(byName.get(name)?.references[0].access).toBe("write");
      }
    });

    it("treats the register destination of MOVEP as written, not read", async () => {
      const textDocument = await createDoc(
        "movep-destination.s",
        ` movep.w 4(a0),d3
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(0, 0, 1, 0),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d3")?.references[0].access).toBe("write");
      expect(byName.get("a0")?.references[0].access).toBe("read");
    });

    it("expands a macro defined with the name as an operand", async () => {
      const textDocument = await createDoc(
        "macro-operand-form.s",
        ` macro Paint
 move.w \\1,d2
 endm
 Paint d4
`,
      );

      const result = provider.onRegisterUsage({
        textDocument,
        range: range(3, 0, 4, 0),
      });
      const byName = new Map(
        result?.registers.map((usage) => [usage.name, usage]),
      );

      expect(byName.get("d4")?.references[0].access).toBe("read");
      expect(byName.get("d2")?.references[0].access).toBe("write");
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

  describe("#onBlockRange()", () => {
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
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(7, 4),
        }),
      ).toEqual({
        range: range(4, 0, 8, 4),
        label: "Second",
      });
    });

    it("continues past an early return that a branch skips", async () => {
      const textDocument = await createDoc(
        "early-return.s",
        `Foo:
  tst.w d0
  bne .continue
  rts
.continue
 move.w d0,d1
 rts
`,
      );

      for (const line of [1, 5]) {
        expect(
          provider.onBlockRange({
            textDocument,
            position: lsp.Position.create(line, 2),
          }),
        ).toEqual({ range: range(0, 0, 6, 4), label: "Foo" });
      }
    });

    it("ends at a tail call without following it", async () => {
      const textDocument = await createDoc(
        "tail-call.s",
        `Foo:
 tst.w d0
 beq.s .done
 moveq #1,d1
 bra Bar
.done:
 rts
Bar:
 rts
`,
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(3, 2),
        }),
      ).toEqual({ range: range(0, 0, 6, 4), label: "Foo" });
    });

    it("follows a jump table through its local targets", async () => {
      const textDocument = await createDoc(
        "jump-table.s",
        `Dispatch:
 add.w d0,d0
 jmp .table(pc,d0.w)
.table:
 bra.s .first
 bra.s .second
.first:
 moveq #1,d1
 rts
.second:
 moveq #2,d1
 rts
`,
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(1, 2),
        }),
      ).toEqual({ range: range(0, 0, 11, 4), label: "Dispatch" });
    });

    it("follows the labels named by a table of offsets", async () => {
      const textDocument = await createDoc(
        "offset-table.s",
        `Dispatch:
 add.w d0,d0
 move.w .offsets(pc,d0.w),d0
 jmp .offsets(pc,d0.w)
.offsets:
 dc.w .first-.offsets
 dc.w .second-.offsets
.first:
 rts
.second:
 moveq #2,d1
 rts
`,
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(1, 2),
        }),
      ).toEqual({ range: range(0, 0, 11, 4), label: "Dispatch" });
    });

    it("has no scope between the end of one block and the next", async () => {
      const textDocument = await createDoc(
        "between-routines.s",
        `Foo:
 moveq #1,d0
 rte

; Next routine
Bar:
 moveq #2,d1
 rts
`,
      );

      for (const line of [3, 4]) {
        expect(
          provider.onBlockRange({
            textDocument,
            position: lsp.Position.create(line, 0),
          }),
        ).toBeUndefined();
      }
      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(6, 1),
        }),
      ).toEqual({ range: range(5, 0, 7, 4), label: "Bar" });
    });

    it("has no scope around data or after an unreached fragment", async () => {
      const textDocument = await createDoc(
        "fragment-gaps.s",
        `Foo:
 rts

.fragment:
 moveq #1,d0
 rts

.table: dc.w 1,2
`,
      );

      const at = (line: number) =>
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(line, 0),
        });
      expect(at(2)).toBeUndefined();
      expect(at(4)).toEqual({ range: range(0, 0, 5, 4), label: "Foo" });
      expect(at(6)).toBeUndefined();
      expect(at(7)).toBeUndefined();
    });

    it("scopes code the block's flow never reaches to the end of its own flow", async () => {
      const textDocument = await createDoc(
        "unreached.s",
        `Foo:
 rts
.fragment:
 moveq #1,d0
 rts
`,
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(0, 1),
        }),
      ).toEqual({ range: range(0, 0, 1, 4), label: "Foo" });
      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(3, 2),
        }),
      ).toEqual({ range: range(0, 0, 4, 4), label: "Foo" });
    });

    it("does not end a block at a return that is conditional", async () => {
      const textDocument = await createDoc(
        "conditional-return.s",
        `First:
 iif DEBUG rts
 moveq #1,d0
 rts
`,
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(1, 2),
        }),
      ).toEqual({
        range: range(0, 0, 3, 4),
        label: "First",
      });
    });

    it("uses the start of the file before the first non-local label", async () => {
      const textDocument = await createDoc(
        "no-label.s",
        " moveq #1,d0\n rts\n",
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(0, 2),
        }),
      ).toEqual({
        range: range(0, 0, 1, 4),
        label: "Start of file",
      });
    });

    it("includes preamble code through the first block's RTS", async () => {
      const textDocument = await createDoc(
        "preamble-label.s",
        ` moveq #1,d0
Start:
 moveq #2,d1
 rts
`,
      );

      const scope = provider.onBlockRange({
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

      const scope = provider.onBlockRange({
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

      const scope = provider.onBlockRange({
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

      const scope = provider.onBlockRange({
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
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(1, 2),
        }),
      ).toEqual({
        range: range(0, 0, 2, 4),
        label: "Handler",
      });
    });

    it("limits the scope to the body of the macro being defined", async () => {
      const textDocument = await createDoc(
        "macro-scope.s",
        `Start:
 moveq #0,d2
Copy macro
.loop:
 move.l (\\1)+,d0
 rts
 endm
 rts
`,
      );

      const scope = provider.onBlockRange({
        textDocument,
        position: lsp.Position.create(4, 2),
      });

      expect(scope).toEqual({
        range: range(2, 0, 6, 5),
        label: "Copy",
      });
      const usage = provider.onRegisterUsage({
        textDocument,
        range: scope!.range,
      });
      expect(usage?.registers.map(({ name }) => name)).toEqual(["d0"]);
    });

    it("runs to the end of the file in an unterminated macro", async () => {
      const textDocument = await createDoc(
        "unterminated-macro.s",
        "Copy macro\n move.l d0,d1\n",
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(1, 2),
        }),
      ).toEqual({
        range: range(0, 0, 2, 0),
        label: "Copy",
      });
    });

    it("ignores labels and returns in a macro body outside it", async () => {
      const textDocument = await createDoc(
        "routine-around-macro.s",
        `Start:
 moveq #0,d2
Copy macro
Inner:
 rts
 endm
 moveq #1,d3
 rts
`,
      );

      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(6, 2),
        }),
      ).toEqual({
        range: range(0, 0, 7, 4),
        label: "Start",
      });
      expect(
        provider.onBlockRange({
          textDocument,
          position: lsp.Position.create(1, 2),
        }),
      ).toEqual({
        range: range(0, 0, 7, 4),
        label: "Start",
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

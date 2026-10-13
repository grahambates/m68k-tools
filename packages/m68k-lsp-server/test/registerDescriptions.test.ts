import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../src/context";
import DocumentProcessor from "../src/DocumentProcessor";
import {
  describeRegister,
  parseRegisterComment,
  parseRoutineHeader,
} from "../src/registerDescriptions";
import { createTestContext } from "./helpers";

describe("parseRegisterComment", () => {
  it.each([
    "d0 = frame count",
    "D0 = frame count",
    "* d0 = frame count",
    "d0 frame count",
    "d0 - frame count",
    "d0: frame count",
    "d0=frame count",
  ])("reads %j", (text) => {
    expect(parseRegisterComment(text)).toEqual({
      registers: ["d0"],
      description: "frame count",
    });
  });

  it("expands ranges and lists, and keeps a size suffix", () => {
    expect(parseRegisterComment("d0-d2 = angles")?.registers).toEqual([
      "d0",
      "d1",
      "d2",
    ]);
    expect(parseRegisterComment("d0/a1/sp = pointers")?.registers).toEqual([
      "d0",
      "a1",
      "a7",
    ]);
    expect(parseRegisterComment("d0.w = count")).toEqual({
      registers: ["d0"],
      size: "w",
      description: "count",
    });
  });

  it.each(["frame count", "d0", "d0x = 1", "spare bytes", "d8 = nope"])(
    "ignores %j",
    (text) => {
      expect(parseRegisterComment(text)).toBeUndefined();
    },
  );
});

describe("parseRoutineHeader", () => {
  it("separates inputs, outputs and trashed registers", () => {
    const header = parseRoutineHeader([
      " Draws a frame",
      "",
      " d1 = colour",
      " Inputs:",
      "   d0 = frame count",
      "   a0 - screen",
      " Out: d0 = pixels drawn",
      " Trashes: d2-d3/a1",
    ]);
    expect(Object.fromEntries(header)).toEqual({
      d0: { input: "frame count", output: "pixels drawn" },
      d1: { input: "colour" },
      a0: { input: "screen" },
      d2: { trashed: true },
      d3: { trashed: true },
      a1: { trashed: true },
    });
  });
});

describe("describeRegister", () => {
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
  });

  // `|` marks the register being described; it is removed from the source.
  const describeAt = async (source: string) => {
    const lines = source.split("\n");
    const line = lines.findIndex((text) => text.includes("|"));
    const character = lines[line].indexOf("|");
    const text = source.replace("|", "");
    const uri = ctx.workspaceFolders[0].uri + "/describe.s";
    await processor.process(TextDocument.create(uri, "vasmmot", 0, text));
    return describeRegister(
      ctx,
      uri,
      lsp.Position.create(line, character),
      text.split("\n")[line].slice(character, character + 2),
    );
  };

  it("uses the routine header for inputs and outputs", async () => {
    expect(
      await describeAt(`; d0 = frame count
; Out: d1 = total
Draw:
  add.w |d0,d1
  rts`),
    ).toMatchObject({
      current: { text: "frame count", source: "header", line: 2 },
      routine: "Draw",
    });
    expect(
      await describeAt(`; Out: d1 = total
Draw:
  add.w d0,|d1
  rts`),
    ).toEqual({ output: "total", routine: "Draw" });
  });

  it("keeps a description across read-modify-writes", async () => {
    expect(
      (
        await describeAt(`; d0 = frame count
Draw:
  addq.w #1,d0
  lsl.w #2,d0
  move.w |d0,d1
  rts`)
      )?.current?.text,
    ).toBe("frame count");
  });

  it("clears a description when the register is overwritten", async () => {
    expect(
      await describeAt(`; d0 = frame count
Draw:
  moveq #0,d0
  move.w |d0,d1
  rts`),
    ).toBeUndefined();
  });

  it("replaces a description from a comment naming the register", async () => {
    expect(
      (
        await describeAt(`; d0 = frame count
Draw:
  tst.w d0 ; d0 = remaining frames
  move.w |d0,d1
  rts`)
      )?.current,
    ).toMatchObject({ text: "remaining frames", source: "comment", line: 2 });
  });

  it("infers a bare comment only when one register is written", async () => {
    expect(
      (
        await describeAt(`Draw:
  move.w #1,d0 ; frame count
  move.w |d0,d1
  rts`)
      )?.current,
    ).toMatchObject({ text: "frame count", source: "inferred-comment" });
    expect(
      await describeAt(`Draw:
  movem.l (a0),d0-d1 ; frame count
  move.w |d0,d2
  rts`),
    ).toBeUndefined();
  });

  it("describes symbolic assignments without a comment", async () => {
    expect(
      (
        await describeAt(`Draw:
  lea SomeTable(pc),a0
  move.w (|a0),d0
  rts
SomeTable: dc.w 0`)
      )?.current,
    ).toMatchObject({
      text: "address of",
      code: "SomeTable(pc)",
      source: "operand",
      line: 1,
    });
    expect(
      (
        await describeAt(`FRAMES = 50
Draw:
  move.l #FRAMES,d0
  move.w |d0,d1
  rts`)
      )?.current,
    ).toMatchObject({ text: "", code: "#FRAMES" });
    expect(
      await describeAt(`Draw:
  moveq #0,d0
  move.w |d0,d1
  rts`),
    ).toBeUndefined();
  });

  it("follows the outputs and trashed registers of called routines", async () => {
    const source = (register: string) => `Main:
  moveq #1,d0 ; d0 = count
  moveq #2,d2 ; d2 = scratch
  bsr Calc
  move.w |${register},d1
  rts

; Outputs: d0 = result
; Trashes: d2
Calc:
  rts`;
    expect((await describeAt(source("d0")))?.current).toMatchObject({
      text: "result",
      source: "call",
      routine: "Calc",
      line: 3,
    });
    expect(await describeAt(source("d2"))).toBeUndefined();
  });

  describe("along control flow", () => {
    const branches = (one: string, two: string) => `Foo:
  tst.w d1
  beq.s .other
  moveq #1,d0 ; d0 = ${one}
  bra.s .done
.other:
  moveq #2,d0 ; d0 = ${two}
.done:
  move.w |d0,d2
  rts`;

    it("drops a description the joining branches disagree on", async () => {
      expect(await describeAt(branches("one", "two"))).toBeUndefined();
    });

    it("keeps a description the joining branches agree on", async () => {
      expect(
        (await describeAt(branches("count", "count")))?.current,
      ).toMatchObject({ text: "count", source: "comment" });
    });

    it("keeps a description from before a branch it survives", async () => {
      expect(
        (
          await describeAt(`; d0 = count
Foo:
  tst.w d1
  beq.s .skip
  addq.w #1,d0
.skip:
  move.w |d0,d2
  rts`)
        )?.current,
      ).toMatchObject({ text: "count", source: "header" });
    });

    it("does not let a skipped reassignment replace a description", async () => {
      expect(
        await describeAt(`; d0 = count
Foo:
  tst.w d1
  beq.s .skip
  moveq #0,d0 ; d0 = index
.skip:
  move.w |d0,d2
  rts`),
      ).toBeUndefined();
    });

    it("joins a loop's entry with its back edge", async () => {
      const loop = (body: string) => `; d0 = count
Foo:
.loop:
  move.w |d0,d1
  ${body}
  bne.s .loop
  rts`;
      expect((await describeAt(loop("subq.w #1,d0")))?.current).toMatchObject({
        text: "count",
        source: "header",
      });
      expect(
        await describeAt(loop("moveq #0,d0 ; d0 = index")),
      ).toBeUndefined();
    });

    it("brings a description back when a register is restored", async () => {
      expect(
        (
          await describeAt(`; d2 = count
Foo:
  movem.l d2,-(sp)
  moveq #0,d2 ; d2 = scratch
  movem.l (sp)+,d2
  move.w |d2,d1
  rts`)
        )?.current,
      ).toMatchObject({ text: "count", source: "header" });
    });

    it("describes code the block's flow enters only by a branch", async () => {
      expect(
        (
          await describeAt(`Foo:
  moveq #1,d0 ; d0 = count
  bne.s .later
  rts
.later:
  move.w |d0,d1
  rts`)
        )?.current,
      ).toMatchObject({ text: "count", line: 1 });
    });
  });

  it("does not carry descriptions across blocks", async () => {
    expect(
      await describeAt(`First:
  moveq #1,d0 ; d0 = count
  rts
Second:
  move.w |d0,d1
  rts`),
    ).toBeUndefined();
  });
});

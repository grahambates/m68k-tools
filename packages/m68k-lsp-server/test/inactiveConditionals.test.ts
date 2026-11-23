import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import DocumentProcessor from "../src/DocumentProcessor";
import { expandInlineStatements, parseBlocks, parseFile } from "m68k-parser";
import { DiagnosticSeverity, DiagnosticTag } from "vscode-languageserver";
import { defaultConfig } from "../src/config";
import DiagnosticProcessor from "../src/diagnostics";
import { createTestContext } from "./helpers";

const uri = "file:///project/main.asm";

async function inactive(source: string, args: string[] = []) {
  const parsed = parseFile(source);
  expandInlineStatements(parsed);
  return new DiagnosticProcessor(
    await createTestContext({ vasm: { ...defaultConfig.vasm, args } }),
  )
    .parserDiagnostics(uri, parsed, parseBlocks(parsed))
    .filter(({ code }) => code === "inactive-conditional");
}

async function lines(source: string) {
  return (await inactive(source)).map(({ range }) => [
    range.start.line,
    range.end.line,
  ]);
}

describe("inactive conditional assembly", async () => {
  it("uses preceding assignments and selects the first matching arm", async () => {
    const source = [
      "FEATURE equ 1",
      "LEVEL set FEATURE+1",
      " ifeq LEVEL",
      " moveq #0,d0",
      " elif LEVEL=2",
      " moveq #1,d0",
      " else",
      " moveq #2,d0",
      " endc",
    ].join("\n");
    expect(await lines(source)).toEqual([
      [3, 4],
      [7, 8],
    ]);
    expect((await inactive(source))[0]).toMatchObject({
      severity: DiagnosticSeverity.Hint,
      tags: [DiagnosticTag.Unnecessary],
    });
  });

  it("leaves external build conditions ambiguous and merges assignments conservatively", async () => {
    const source = [
      "COUNT set 0",
      " ifne BUILD_FLAG",
      "COUNT set 1",
      " else",
      "COUNT set 2",
      " endc",
      " ifeq COUNT",
      " nop",
      " endc",
    ].join("\n");
    expect(await lines(source)).toEqual([]);
    expect(await lines(source.replace("COUNT set 2", "COUNT set 1"))).toEqual([
      [7, 8],
    ]);
  });

  it("keeps immutable constants across includes, macro calls and repeats", async () => {
    const source = [
      "TURN1_SPEED = 16",
      "SCALE equ 2",
      "COUNT set 0",
      ' include "config.i"',
      " callMacro",
      " rept 3",
      "COUNT set COUNT+1",
      " endr",
      " ifeq TURN1_SPEED-16",
      " add.w d0,d0",
      " add.w d0,d0",
      " else",
      " mulu #TURN1_SPEED,d0",
      " lsr.l #2,d0",
      " endc",
      " ifne SCALE-2",
      " nop",
      " endc",
      " ifeq COUNT",
      " nop",
      " else",
      " illegal",
      " endc",
    ].join("\n");
    expect(await lines(source)).toEqual([
      [12, 14],
      [16, 17],
    ]);
  });

  it("uses an indexed include constant only after the include executes", async () => {
    const folder = await mkdtemp(join(tmpdir(), "m68k-conditional-"));
    try {
      await writeFile(
        join(folder, "consts.i"),
        " ifnd COLORS\nCOLORS = 64\n endc\n",
      );
      const uri = pathToFileURL(join(folder, "main.asm")).href;
      const text = [
        " ifeq COLORS-64",
        " nop",
        " endc",
        ' include "consts.i"',
        " ifeq COLORS-64",
        " lsl.w #7,d0",
        " else",
        " mulu #COLORS*2,d0",
        " endc",
      ].join("\n");
      const ctx = await createTestContext();
      const processed = await new DocumentProcessor(ctx).process(
        TextDocument.create(uri, "m68k", 1, text),
      );
      const tags = new DiagnosticProcessor(ctx)
        .parserDiagnostics(uri, processed.parsed, processed.blocks)
        .filter((diagnostic) => diagnostic.code === "inactive-conditional");
      expect(
        tags.map(({ range }) => [range.start.line, range.end.line]),
      ).toEqual([[7, 8]]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("resolves bitmask expressions from a guarded header also included indirectly", async () => {
    const folder = await mkdtemp(join(tmpdir(), "m68k-header-guard-"));
    try {
      await writeFile(
        join(folder, "hw.i"),
        [
          " ifnd _HW_I",
          "_HW_I set 1",
          "DMAF_SETCLR = $8000",
          "DMAF_MASTER = $0200",
          "DMAF_RASTER = $0100",
          "DMAF_COPPER = $0080",
          "DMAF_BLITTER = $0040",
          " endc",
        ].join("\n"),
      );
      await writeFile(join(folder, "startup.i"), ' include "hw.i"\n');
      const uri = pathToFileURL(join(folder, "main.asm")).href;
      const text = [
        ' include "startup.i"',
        ' include "hw.i"',
        "DMASET = DMAF_SETCLR!DMAF_MASTER!DMAF_RASTER!DMAF_COPPER!DMAF_BLITTER",
        " ifeq DMASET-$83C0",
        " nop",
        " else",
        " illegal",
        " endc",
      ].join("\n");
      for (const [args, expected] of [
        [[], [[6, 7]]],
        [["-D_HW_I"], []],
      ] as const) {
        const ctx = await createTestContext({
          vasm: { ...defaultConfig.vasm, args: [...args] },
        });
        const doc = await new DocumentProcessor(ctx).process(
          TextDocument.create(uri, "m68k", 1, text),
        );
        const diagnostics = new DiagnosticProcessor(ctx).parserDiagnostics(
          uri,
          doc.parsed,
          doc.blocks,
        );
        expect(
          diagnostics
            .filter((d) => d.code === "inactive-conditional")
            .map(({ range }) => [range.start.line, range.end.line]),
        ).toEqual(expected);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("uses a guarded source default and honours configured vasm definitions", async () => {
    const source = [
      " ifnd DIRECTIONAL_SKIP",
      "DIRECTIONAL_SKIP = 1",
      " endc",
      " ifne DIRECTIONAL_SKIP",
      " lea SkipMax-SKIP_FIRST_LEVEL,a5",
      " else",
      " lea SkipMax,a5",
      " endc",
    ].join("\n");
    const starts = async (text: string, args: string[] = []) =>
      (await inactive(text, args)).map(({ range }) => range.start.line);
    expect(await starts(source)).toEqual([6]);
    expect(await starts(source, ["-D", "DIRECTIONAL_SKIP=0"])).toEqual([1, 4]);
    expect(await starts(source, ["-DDIRECTIONAL_SKIP"])).toEqual([1, 6]);
    expect(await starts(source, ["-DDIRECTIONAL_SKIP=UNRESOLVED"])).toEqual([
      1,
    ]);
    expect(await starts(' include "unknown.i"\n' + source)).toEqual([]);
  });

  it("never treats unresolved symbols or template arguments as zero", async () => {
    expect(
      await lines(
        [
          " ifnd BUILD_FLAG",
          " nop",
          " else",
          " illegal",
          " endc",
          "M macro",
          " ifne \\1",
          " nop",
          " else",
          " illegal",
          " endc",
          " endm",
          " rept 3",
          " ifne REPTN",
          " nop",
          " endc",
          " endr",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("resolves a constant from one defined after it, once that is defined", async () => {
    const source = [
      "A equ B*2",
      " ifd A",
      " nop",
      " else",
      " illegal",
      " endc",
      "B equ 3",
      " ifeq A-6",
      " nop",
      " else",
      " illegal",
      " endc",
    ].join("\n");
    // A is defined from its own line, though not yet known; vasm decides each
    // condition where it stands.
    expect(await lines(source)).toEqual([
      [4, 5],
      [10, 11],
    ]);
  });

  it("leaves constants defined in terms of each other unknown", async () => {
    expect(
      await lines(
        ["A equ B", "B equ A", " ifeq A", " nop", " endc"].join("\n"),
      ),
    ).toEqual([]);
  });

  // Offsets measured against vasm 2.0f with -no-opt, with and without -devpac.
  it.each([
    [[], 1, 3],
    [["-devpac"], 2, 4],
    [["-align"], 2, 4],
  ])("counts RS offsets with vasm args %j", async (args, b, c) => {
    const source = [
      " rsreset",
      "a rs.b 1",
      "b rs.w 1",
      "c rs.l 1",
      ` ifeq b-${b}`,
      " nop",
      " else",
      " illegal",
      " endc",
      ` ifeq c-${c}`,
      " nop",
      " else",
      " illegal",
      " endc",
    ].join("\n");
    expect(
      (await inactive(source, args)).map(({ range }) => range.start.line),
    ).toEqual([7, 12]);
  });

  it.each([
    // FO moves the counter down before the label takes it. Aligned, vasm
    // takes (x - 1) & ~1, so an even counter still moves: -8 becomes -10.
    [[], [-1, -3, -7]],
    [["-align"], [-1, -4, -10]],
  ])("counts FO offsets with vasm args %j", async (args, expected) => {
    const checks = ["a", "b", "c"].flatMap((name, i) => [
      ` ifeq ${name}-(${expected[i]})`,
      " nop",
      " else",
      " illegal",
      " endc",
    ]);
    const source = [
      " clrfo",
      "a fo.b 1",
      "b fo.w 1",
      "c fo.l 1",
      ...checks,
    ].join("\n");
    expect(
      (await inactive(source, args)).map(({ range }) => range.start.line),
    ).toEqual([7, 12, 17]);
  });

  it("follows RSSET, SO and __RS, and counts with a later constant", async () => {
    const source = [
      " rsset 100",
      "i rs.w 2",
      "size equ __RS",
      " clrso",
      "p so.w 3",
      "q so.b 0",
      " rsreset",
      "x rs.w later",
      "y rs.b 0",
      "later equ 3",
      " ifeq (i-100)+(size-104)+(q-6)+(y-6)",
      " nop",
      " else",
      " illegal",
      " endc",
    ].join("\n");
    expect(await lines(source)).toEqual([[13, 14]]);
  });

  it("does not assume offset counters start at zero in an included file", async () => {
    const ctx = await createTestContext();
    const document = TextDocument.create(
      "file:///project/struct.i",
      "vasmmot",
      0,
      ["early rs.w 1", " rsreset", "first rs.w 1", "second rs.l 1"].join("\n"),
    );
    const processed = await new DocumentProcessor(ctx).process(document);
    const constants = processed.assemblyConstants?.constants;
    expect(constants?.get("first")).toBe(0);
    expect(constants?.get("second")).toBe(2);
    expect(constants?.has("early")).toBe(false);
  });

  it("merges what nested arms change, and what a macro call in an arm forgets", async () => {
    const source = [
      "Wait macro",
      " nop",
      " endm",
      "COUNT set 1",
      "KEEP set 5",
      "SIZE equ 3",
      " ifne BUILD",
      " ifne 1",
      "COUNT set 2",
      " endc",
      " else",
      "COUNT set 2",
      " endc",
      // Every path leaves COUNT at 2.
      " ifeq COUNT-2",
      " nop",
      " else",
      " illegal",
      " endc",
      " ifne BUILD",
      " Wait",
      " endc",
      // The macro may have changed KEEP, on one path only.
      " ifeq KEEP-5",
      " nop",
      " else",
      " illegal",
      " endc",
      // A constant cannot change, whatever the macro does.
      " ifeq SIZE-3",
      " nop",
      " else",
      " illegal",
      " endc",
    ].join("\n");
    expect(await lines(source)).toEqual([
      [16, 17],
      [29, 30],
    ]);
  });

  it("dims the statement of a known-false inline condition", async () => {
    expect((await inactive(" iif 0 nop"))[0]?.range.start).toEqual({
      line: 0,
      character: 7,
    });
  });
});

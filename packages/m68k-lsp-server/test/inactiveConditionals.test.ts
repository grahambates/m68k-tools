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
      await writeFile(join(folder, "consts.i"), "COLORS = 64\n");
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

  it("dims the statement of a known-false inline condition", async () => {
    expect((await inactive(" iif 0 nop"))[0]?.range.start).toEqual({
      line: 0,
      character: 7,
    });
  });
});

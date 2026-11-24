import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseFile } from "m68k-parser";

import { type Config } from "../src/config";
import DocumentProcessor from "../src/DocumentProcessor";
import { platformEvidence } from "../src/platform";
import ColorProvider from "../src/providers/ColorProvider";
import HoverProvider from "../src/providers/HoverProvider";
import { createContext } from "../src/context";
import { createTestContext, NullLogger } from "./helpers";

/** Hover text at a position, in a fresh workspace holding just `source`. */
async function hoverText(
  source: string,
  line: number,
  column: number,
  config: Partial<Config> = {},
) {
  const ctx = await createTestContext(config);
  const textDocument = TextDocument.create(
    ctx.workspaceFolders[0].uri + "/addresses.s",
    "vasmmot",
    0,
    source,
  );
  await new DocumentProcessor(ctx).process(textDocument);
  const hover = await new HoverProvider(ctx).onHover({
    textDocument,
    position: lsp.Position.create(line, column),
  });
  const contents = hover?.contents;
  if (!contents) return "";
  return (Array.isArray(contents) ? contents : [contents])
    .map((part) => (typeof part === "string" ? part : part.value))
    .join("\n");
}

async function colours(source: string, config: Partial<Config> = {}) {
  const ctx = await createTestContext(config);
  const textDocument = TextDocument.create(
    ctx.workspaceFolders[0].uri + "/colours.s",
    "vasmmot",
    0,
    source,
  );
  await new DocumentProcessor(ctx).process(textDocument);
  return new ColorProvider(ctx).onDocumentColor({ textDocument });
}

describe("platform evidence", () => {
  test.each([
    [' include "hardware/custom.i"'],
    [" include exec/exec_lib.i"],
    [" jsr _LVOForbid(a6)"],
    [" lea _custom,a6"],
    [" move.w d0,dmacon(a6)"],
    [" move.w #$7fff,$dff09a"],
    [" btst #6,$bfe001"],
    [" move.l #$00dff000,d0"],
  ])("finds the Amiga in %s", (source) => {
    expect(platformEvidence(parseFile(source))).toEqual(["amiga"]);
  });

  test.each([
    [" move.w d0,$96(a6)"],
    [' include "macros.i"'],
    [" move.w #$0180,d0"],
  ])("finds nothing in %s", (source) => {
    expect(platformEvidence(parseFile(source))).toEqual([]);
  });
});

describe("Amiga registers by address", () => {
  it("documents a custom register given by its address", async () => {
    expect(await hoverText(" move.w d0,$dff09a", 0, 14)).toContain(
      "**INTENA** · $DFF09A",
    );
  });

  it("follows an address register loaded with the custom base", async () => {
    const source = " lea $dff000,a6\n move.w #$8200,$96(a6)";
    expect(await hoverText(source, 1, 17)).toContain("**DMACON** · $DFF096");
    expect(await hoverText(source, 1, 10)).toContain(
      "Written to **DMACON**: Sets DMAEN",
    );
  });

  it("reads the base through a constant and a long move", async () => {
    const source =
      "CUSTOM equ $dff000\n move.l #CUSTOM,a5\n move.w #$0f00,$180(a5)";
    expect(await hoverText(source, 2, 18)).toContain("**COLOR00**");
  });

  it("forgets a scratch register over a call, and stops at a routine's start", async () => {
    expect(
      await hoverText(" lea $dff000,a0\n bsr Wait\n move.w d0,$96(a0)", 2, 14),
    ).not.toContain("DMACON");
    expect(
      await hoverText(" lea $dff000,a6\nRoutine:\n move.w d0,$96(a6)", 2, 14),
    ).not.toContain("DMACON");
    // A5 and A6 survive a call.
    expect(
      await hoverText(" lea $dff000,a6\n bsr Wait\n move.w d0,$96(a6)", 2, 14),
    ).toContain("DMACON");
  });

  it("does not repeat what the register's name already says", async () => {
    const text = await hoverText(
      " lea $dff000,a6\n move.w #$8200,dmacon(a6)",
      1,
      10,
    );
    expect(text.match(/Written to/g)).toHaveLength(1);
  });

  it("documents CIA registers and bits by address", async () => {
    expect(await hoverText(" btst #6,$bfe001", 0, 7)).toContain(
      "Bit 6 of **CIA-A PRA**: /FIR0",
    );
    expect(await hoverText(" btst #6,$bfe001", 0, 11)).toContain(
      "CIA-A PRA · $BFE001",
    );
    expect(await hoverText(" move.b #$7f,$bfed01", 0, 10)).toContain(
      "Written to **CIA-A ICR**: Clears",
    );
  });

  describe("platform setting", () => {
    // An address worked out, with no hardware address written anywhere.
    const computed = " lea $df0000+$f000,a6\n move.w d0,$96(a6)";

    it("leaves addresses alone where the workspace shows no sign of the Amiga", async () => {
      expect(await hoverText(computed, 1, 14)).not.toContain("DMACON");
    });

    it("reads them where the platform is set", async () => {
      expect(await hoverText(computed, 1, 14, { platform: "amiga" })).toContain(
        "**DMACON**",
      );
    });

    it("turns everything off with none", async () => {
      const options = { platform: "none" as const };
      expect(
        await hoverText(" move.w d0,$dff09a", 0, 14, options),
      ).not.toContain("INTENA");
      expect(
        await hoverText(" move.w d0,intena(a6)", 0, 14, options),
      ).not.toContain("INTENA");
      expect(await colours("copper:\n dc.w COLOR00,$0abc\n", options)).toEqual(
        [],
      );
    });
  });
});

// A project building for several machines from shared code names each
// build's platform in that build's own .m68krc.json.
describe("platform set per project", () => {
  let dir: string;
  const source = " move.w d0,$dff09a\n move.w d0,intena(a6)\n";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-platform-"));
    for (const build of ["amiga", "other"])
      await mkdir(join(dir, build), { recursive: true });
    await writeFile(
      join(dir, "other", ".m68krc.json"),
      JSON.stringify({ platform: "none" }),
    );
    for (const build of ["amiga", "other"])
      await writeFile(join(dir, build, "main.s"), source);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function hoverIn(build: string, line: number, column: number) {
    const ctx = await createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "workspace" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
    const path = join(dir, build, "main.s");
    const textDocument = TextDocument.create(
      pathToFileURL(path).toString(),
      "vasmmot",
      0,
      await readFile(path, "utf8"),
    );
    await new DocumentProcessor(ctx).process(textDocument);
    const hover = await new HoverProvider(ctx).onHover({
      textDocument,
      position: lsp.Position.create(line, column),
    });
    return JSON.stringify(hover?.contents ?? "");
  }

  it("goes by the nearest config to each file", async () => {
    expect(await hoverIn("amiga", 0, 14)).toContain("INTENA");
    expect(await hoverIn("amiga", 1, 14)).toContain("INTENA");
    expect(await hoverIn("other", 0, 14)).not.toContain("INTENA");
    expect(await hoverIn("other", 1, 14)).not.toContain("INTENA");
  });
});

describe("Amiga colours by address", () => {
  it("shows colours moved into a colour register given by address", async () => {
    const [info] = await colours(" lea $dff000,a6\n move.w #$0f00,$180(a6)\n");
    expect(info.range).toEqual(lsp.Range.create(1, 9, 1, 14));
    expect(info.color).toEqual({ red: 1, green: 0, blue: 0, alpha: 1 });
  });

  it("shows colours in a Copper list written as numbers", async () => {
    const found = await colours(
      "copper:\n dc.w $0180,$00f0\n dc.w $0100,$0200\n dc.w $ffff,$fffe\n",
    );
    expect(found.map((info) => info.range)).toEqual([
      lsp.Range.create(1, 12, 1, 17),
    ]);
  });

  it("leaves number pairs outside a Copper list alone", async () => {
    expect(await colours("data:\n dc.w $0180,$00f0\n")).toEqual([]);
  });
});

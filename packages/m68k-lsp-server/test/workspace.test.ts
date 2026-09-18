import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";

import { createContext } from "../src/context";
import DocumentProcessor from "../src/DocumentProcessor";
import { indexWorkspace } from "../src/workspace";
import RegisterProvider from "../src/providers/RegisterProvider";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  getAsmFilesInDir,
  getEntryPoints,
  getEntryPointsFor,
} from "../src/files";
import { NullLogger } from "./helpers";

describe("indexWorkspace", () => {
  let dir: string;

  const write = async (name: string, text: string) => {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text, "utf8");
    return pathToFileURL(path).toString();
  };

  const contextFor = async (config = {}) => {
    const connection = {
      sendDiagnostics: vi.fn(),
    } as unknown as lsp.Connection;
    return createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "ws" }],
      new NullLogger(),
      connection,
      config,
    );
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-ws-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("indexes assembly files without opening them", async () => {
    await write("main.s", "Start:\n bsr Helper\nHelper:\n rts\n");
    await write("defs.i", "CUSTOM equ $dff000\n");

    const ctx = await contextFor();
    const count = await indexWorkspace(ctx, new DocumentProcessor(ctx));

    expect(count).toBe(2);
    expect(ctx.store.size).toBe(2);

    const main = [...ctx.store.values()].find((d) => d.uri.endsWith("main.s"));
    expect(main?.symbols.definitions.has("Start")).toBe(true);
    // Indexed files keep symbols but no syntax tree.
    expect(main).not.toHaveProperty("parsed");
  });

  it("skips build output directories", async () => {
    await write("main.s", "Start:\n rts\n");
    await write("build/main.s", "Start:\n rts\n");
    await write("node_modules/pkg/thing.s", "Start:\n rts\n");

    const ctx = await contextFor();
    const count = await indexWorkspace(ctx, new DocumentProcessor(ctx));

    expect(count).toBe(1);
    expect([...ctx.store.keys()][0]).toContain("main.s");
    expect([...ctx.store.keys()].join()).not.toContain("build");
  });

  it("honours additional exclude patterns from config", async () => {
    await write("main.s", "Start:\n rts\n");
    await write("vendor/lib.i", "LIB equ 1\n");

    const ctx = await contextFor({ exclude: ["**/vendor/**"] });
    const count = await indexWorkspace(ctx, new DocumentProcessor(ctx));

    expect(count).toBe(1);
    expect([...ctx.store.keys()].join()).not.toContain("vendor");
  });

  it("does not enumerate excluded directory contents", async () => {
    const source = await write("src/main.s", "Start:\n rts\n");
    for (const directory of [
      "node_modules",
      ".git",
      "build",
      "out",
      "dist",
      "target",
      "vendor",
    ]) {
      await write(`${directory}/nested/ignored.s`, "Ignored equ 1\n");
    }
    const ctx = await contextFor({ exclude: ["**/vendor/**"] });
    const readdir = vi.spyOn(fsp, "readdir");
    await indexWorkspace(ctx, new DocumentProcessor(ctx));

    expect([...ctx.store.keys()]).toEqual([source]);
    // The walk itself works in filesystem paths, converting to URIs only at
    // the LSP boundary, so that is what reaches readdir here.
    expect(readdir.mock.calls.map(([path]) => String(path)).sort()).toEqual(
      [dir, join(dir, "src")].sort(),
    );
  });

  it("keeps traversing folders when only particular files are excluded", async () => {
    const kept = await write("src/kept.i", "Kept equ 1\n");
    await write("src/generated.s", "Ignored equ 1\n");
    const nested = await write("sources.s/nested/kept.i", "Nested equ 1\n");
    const ctx = await contextFor({ exclude: ["**/*.s"] });
    await indexWorkspace(ctx, new DocumentProcessor(ctx));
    expect([...ctx.store.keys()].sort()).toEqual([kept, nested].sort());
  });

  it("keeps directory enumeration unfiltered for file operations", async () => {
    const source = await write("main.s", "Start:\n rts\n");
    const generated = await write("build/generated.s", "Generated equ 1\n");
    expect(
      (await getAsmFilesInDir(pathToFileURL(dir).toString())).sort(),
    ).toEqual([source, generated].sort());
  });

  it("records include edges so units can be worked out", async () => {
    await write("main.s", ' include "defs.i"\nStart:\n rts\n');
    await write("defs.i", "CUSTOM equ $dff000\n");

    const ctx = await contextFor();
    await indexWorkspace(ctx, new DocumentProcessor(ctx));

    const main = [...ctx.store.values()].find((d) => d.uri.endsWith("main.s"));
    expect(main?.referencedUris).toHaveLength(1);
    expect(main?.referencedUris[0]).toContain("defs.i");
  });

  it("leaves an already open document alone", async () => {
    const uri = await write("main.s", "Start:\n rts\n");

    const ctx = await contextFor();
    const processor = new DocumentProcessor(ctx);
    const { TextDocument } = await import("vscode-languageserver-textdocument");
    await processor.process(
      TextDocument.create(uri, "vasmmot", 1, "Start:\n rts\n"),
    );

    await indexWorkspace(ctx, processor);

    // Still the processed entry, with its tree intact.
    expect(ctx.store.get(uri)).toHaveProperty("parsed");
  });

  it("preserves register analysis when a document opens during indexing", async () => {
    const uri = await write("main.s", "Start:\n move d0,d1\n rts\n");
    const ctx = await contextFor();
    const processor = new DocumentProcessor(ctx);

    // The disk read yields before indexing stores its result. Opening the
    // editor in that interval must keep the newer text and its syntax tree.
    const indexing = processor.index(uri);
    const opened = await processor.process(
      TextDocument.create(uri, "m68k", 1, "Start:\n move d2,d3\n rts\n"),
    );
    await indexing;

    expect(ctx.store.get(uri)).toBe(opened);
    const provider = new RegisterProvider(ctx);
    const textDocument = { uri };
    const scope = provider.onRoutineRange({
      textDocument,
      position: { line: 1, character: 2 },
    });
    expect(scope?.label).toBe("Start");
    expect(
      provider
        .onRegisterUsage({ textDocument, range: scope!.range })
        ?.registers.map(({ name }) => name),
    ).toEqual(["d2", "d3"]);
  });

  describe("entry points", () => {
    it("finds files that are assembled rather than included", async () => {
      await write("progA.s", ' include "hw.i"\nStart:\n rts\n');
      await write("progB.s", ' include "hw.i"\nStart:\n rts\n');
      await write("hw.i", "CUSTOM equ $dff000\n");

      const ctx = await contextFor();
      await indexWorkspace(ctx, new DocumentProcessor(ctx));

      const entryPoints = getEntryPoints(ctx).map((u) => u.split("/").pop());
      expect(entryPoints.sort()).toEqual(["progA.s", "progB.s"]);
    });

    it("does not count a file that includes nothing as an entry point", async () => {
      // Vendored headers and data files are orphans, not programs.
      await write("main.s", ' include "hw.i"\n rts\n');
      await write("hw.i", "CUSTOM equ $dff000\n");
      await write("orphan.i", "UNUSED equ 1\n");

      const ctx = await contextFor();
      await indexWorkspace(ctx, new DocumentProcessor(ctx));

      const entryPoints = getEntryPoints(ctx).map((u) => u.split("/").pop());
      expect(entryPoints).toEqual(["main.s"]);
    });

    it("attributes a shared include to every program using it", async () => {
      const hw = await write("hw.i", "CUSTOM equ $dff000\n");
      await write("progA.s", ' include "hw.i"\n rts\n');
      await write("progB.s", ' include "hw.i"\n rts\n');

      const ctx = await contextFor();
      await indexWorkspace(ctx, new DocumentProcessor(ctx));

      const owners = getEntryPointsFor(hw, ctx).map((u) => u.split("/").pop());
      expect(owners.sort()).toEqual(["progA.s", "progB.s"]);
    });

    it("puts a program first among its own entry points", async () => {
      const main = await write("main.s", ' include "hw.i"\n rts\n');
      await write("hw.i", "CUSTOM equ $dff000\n");

      const ctx = await contextFor();
      await indexWorkspace(ctx, new DocumentProcessor(ctx));

      expect(getEntryPointsFor(main, ctx)).toEqual([main]);
    });
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { type Config, defaultConfig } from "../src/config";
import { createContext } from "../src/context";
import DiagnosticProcessor from "../src/diagnostics";
import DocumentProcessor from "../src/DocumentProcessor";
import { NullLogger } from "./helpers";

describe("an include vasm cannot find", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-inferred-"));
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "lib"));
    // Named from the project root, where a build would be run, not from src.
    await writeFile(
      join(dir, "src", "main.s"),
      '\tinclude "lib/defs.i"\n\tmoveq #VALUE,d0\n\trts\n',
    );
    await writeFile(join(dir, "lib", "defs.i"), "VALUE = 1\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const setup = async (
    config: Partial<Config> = {},
    main = '\tinclude "lib/defs.i"\n\tmoveq #VALUE,d0\n\trts\n',
  ) => {
    await writeFile(join(dir, "src", "main.s"), main);
    const ctx = await createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "p" }],
      new NullLogger(),
      {} as lsp.Connection,
      { vasm: { ...defaultConfig.vasm, preferWasm: true }, ...config },
    );
    const processor = new DocumentProcessor(ctx);
    for (const [path, text] of [
      [join("src", "main.s"), main],
      [join("lib", "defs.i"), "VALUE = 1\n"],
    ])
      await processor.process(
        TextDocument.create(
          pathToFileURL(join(dir, path)).toString(),
          "vasmmot",
          1,
          text,
        ),
      );
    return {
      ctx,
      diagnostics: new DiagnosticProcessor(ctx),
      uri: pathToFileURL(join(dir, "src", "main.s")).toString(),
    };
  };
  const errors = (found: { severity?: number }[]) =>
    found.filter((d) => d.severity === 1);

  it("is predicted from the source, so vasm is run with the directory the first time", async () => {
    const { diagnostics, uri } = await setup();
    expect(errors(await diagnostics.vasmDiagnostics(uri))).toEqual([]);
    const [note, ...more] = await diagnostics.includeDiagnostics(uri);
    expect(more).toEqual([]);
    expect(note).toMatchObject({
      code: "inferred-include-path",
      severity: 3,
      // At the include that needed it.
      range: { start: { line: 0 } },
      data: { dir, kind: "sourceRoot", name: "lib/defs.i" },
    });
    expect(note.message).toContain(dir);
  });

  it("is noted even when vasm is not used", async () => {
    const { diagnostics, uri } = await setup({
      vasm: { ...defaultConfig.vasm, provideDiagnostics: false },
    });
    expect(await diagnostics.vasmDiagnostics(uri)).toEqual([]);
    expect(await diagnostics.includeDiagnostics(uri)).toHaveLength(1);
  });

  it("is found on the second run when the name cannot be read from the source", async () => {
    // The include is built from a macro argument, so nothing names lib/defs.i
    // until vasm expands it and fails: the fallback that runs it again.
    const { diagnostics, uri } = await setup(
      {},
      'm\tmacro\n\tinclude "lib/\\1.i"\n\tendm\n\tm defs\n\tmoveq #VALUE,d0\n\trts\n',
    );
    expect(await diagnostics.includeDiagnostics(uri)).toEqual([]);
    const found = await diagnostics.vasmDiagnostics(uri);
    expect(errors(found)).toEqual([]);
    expect(found.some((d) => d.code === "inferred-include-path")).toBe(true);
  });

  it("is left as the error it is when guessing is off", async () => {
    const { diagnostics, uri } = await setup({ inferIncludePaths: false });
    const found = await diagnostics.vasmDiagnostics(uri);
    expect(errors(found).length).toBeGreaterThan(0);
    expect(found.some((d) => d.code === "inferred-include-path")).toBe(false);
    expect(await diagnostics.includeDiagnostics(uri)).toEqual([]);
  });

  it("is left alone when nothing has that path", async () => {
    const { ctx, diagnostics, uri } = await setup();
    // No file in the project ends in lib/defs.i.
    ctx.store.delete(pathToFileURL(join(dir, "lib", "defs.i")).toString());
    await rm(join(dir, "lib", "defs.i"));
    expect(
      errors(await diagnostics.vasmDiagnostics(uri)).length,
    ).toBeGreaterThan(0);
    expect(await diagnostics.includeDiagnostics(uri)).toEqual([]);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";
import { createContext } from "../src/context";
import { defaultConfig, sourceRootOf, type Config } from "../src/config";
import DiagnosticProcessor from "../src/diagnostics";
import { resolveInclude } from "../src/files";
import { NullLogger } from "./helpers";

describe("sourceRoot", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-root-"));
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "lib"));
    // The include is named from the project root, as a build run from there would.
    await writeFile(
      join(dir, "src", "main.s"),
      '\tinclude "lib/defs.i"\n\tmoveq #VALUE,d0\n\trts\n',
    );
    await writeFile(join(dir, "lib", "defs.i"), "VALUE = 1\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const context = (config: Partial<Config> = {}) =>
    createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "p" }],
      new NullLogger(),
      {} as lsp.Connection,
      config,
    );

  it("is taken from the first workspace folder when relative", () => {
    expect(sourceRootOf({ ...defaultConfig, sourceRoot: "." }, [dir])).toBe(
      dir,
    );
    expect(sourceRootOf(defaultConfig, [dir])).toBeUndefined();
  });

  it("finds an include named from the source root", async () => {
    const uri = pathToFileURL(join(dir, "src", "main.s")).toString();
    const without = await resolveInclude(uri, "defs.i", await context());
    expect(without).toBeUndefined();

    const ctx = await context({ sourceRoot: "lib" });
    expect(await resolveInclude(uri, "defs.i", ctx)).toBe(
      join(dir, "lib", "defs.i"),
    );
  });

  it("runs vasm from the source root, so such an include assembles", async () => {
    const uri = pathToFileURL(join(dir, "src", "main.s")).toString();
    const run = async (config: Partial<Config>) =>
      new DiagnosticProcessor(
        await context({
          ...config,
          vasm: { ...defaultConfig.vasm, preferWasm: true },
        }),
      ).vasmDiagnostics(uri);

    const errors = (found: { severity?: number }[]) =>
      found.filter((d) => d.severity === 1);
    expect(errors(await run({})).length).toBeGreaterThan(0);
    expect(errors(await run({ sourceRoot: "." }))).toEqual([]);
  });
});

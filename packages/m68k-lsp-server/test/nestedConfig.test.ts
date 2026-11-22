import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";
import { createContext } from "../src/context";
import { defaultConfig } from "../src/config";
import DiagnosticProcessor from "../src/diagnostics";
import { resolveInclude } from "../src/files";
import { NullLogger } from "./helpers";

// Issue #25: the editor's workspace folder is a parent of the project, and the
// project's .m68krc.json, below it, decides how the project is assembled.
describe("a project config below the workspace folder", () => {
  let dir: string;
  const source = '\tinclude "defs.i"\n\tmuls.l #VALUE,d0\n\trts\n';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-nested-"));
    for (const project of ["intro", "other"]) {
      await mkdir(join(dir, "demos", project, "src"), { recursive: true });
      await mkdir(join(dir, "demos", project, "include"));
      await writeFile(join(dir, "demos", project, "src", "main.s"), source);
      await writeFile(
        join(dir, "demos", project, "include", "defs.i"),
        "VALUE = 2\n",
      );
    }
    // Only one of the two projects says how it is assembled.
    await writeFile(
      join(dir, "demos", "intro", ".m68krc.json"),
      JSON.stringify({ processors: ["mc68020"], includePaths: ["include"] }),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const context = () =>
    createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "workspace" }],
      new NullLogger(),
      {} as lsp.Connection,
      { vasm: { ...defaultConfig.vasm, preferWasm: true } },
    );
  const main = (project: string) =>
    pathToFileURL(join(dir, "demos", project, "src", "main.s")).toString();
  const errors = (found: { severity?: number }[]) =>
    found.filter((d) => d.severity === 1);

  it("assembles with the project's processors and include paths", async () => {
    const diagnostics = new DiagnosticProcessor(await context());
    expect(errors(await diagnostics.vasmDiagnostics(main("intro")))).toEqual(
      [],
    );
    expect(
      errors(await diagnostics.vasmDiagnostics(main("other"))).length,
    ).toBeGreaterThan(0);
  });

  it("resolves includes through the project's include paths", async () => {
    const ctx = await context();
    expect(await resolveInclude(main("intro"), "defs.i", ctx)).toBe(
      join(dir, "demos", "intro", "include", "defs.i"),
    );
    expect(await resolveInclude(main("other"), "defs.i", ctx)).toBeUndefined();
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createContext } from "../src/context";
import DocumentProcessor from "../src/DocumentProcessor";
import { resolveInclude } from "../src/files";
import { NullLogger } from "./helpers";

describe("where an include is looked for", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-include-search-"));
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "lib"));
    await mkdir(join(dir, "elsewhere"));
    await writeFile(join(dir, "src", "c.i"), "C = 1\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("includes the directory of the program, as vasm does", async () => {
    // lib/a.i names "c.i", which is beside src/main.s, the program it is part
    // of. vasm finds it there and not beside lib/a.i (checked with vasm 1.9).
    const ctx = await createContext(
      [{ uri: pathToFileURL(join(dir, "elsewhere")).toString(), name: "w" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
    const processor = new DocumentProcessor(ctx);
    const uri = (...parts: string[]) =>
      pathToFileURL(join(dir, ...parts)).toString();
    await processor.process(
      TextDocument.create(
        uri("src", "main.s"),
        "vasmmot",
        1,
        '\tinclude "../lib/a.i"\n',
      ),
    );
    await processor.process(
      TextDocument.create(uri("lib", "a.i"), "vasmmot", 1, '\tinclude "c.i"\n'),
    );
    await writeFile(join(dir, "lib", "a.i"), '\tinclude "c.i"\n');
    await writeFile(join(dir, "src", "main.s"), '\tinclude "../lib/a.i"\n');
    // Re-process now the files exist, so the include graph is known.
    await processor.process(
      TextDocument.create(
        uri("src", "main.s"),
        "vasmmot",
        2,
        '\tinclude "../lib/a.i"\n',
      ),
    );

    expect(await resolveInclude(uri("lib", "a.i"), "c.i", ctx)).toBe(
      join(dir, "src", "c.i"),
    );
  });
});

import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import * as lsp from "vscode-languageserver";
import { createContext } from "../../src/context";
import CodeActionProvider from "../../src/providers/CodeActionProvider";
import { NullLogger } from "../helpers";

describe("CodeActionProvider", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-code-action-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const actionsFor = async (kind: "sourceRoot" | "includePath") => {
    const ctx = await createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "p" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
    const diagnostic: lsp.Diagnostic = {
      range: lsp.Range.create(0, 0, 0, 0),
      message: "found",
      code: "inferred-include-path",
      data: { dir: join(dir, "inc"), kind, name: "x.i" },
    };
    return new CodeActionProvider(ctx).onCodeAction({
      textDocument: { uri: "file:///x.s" },
      range: diagnostic.range,
      context: { diagnostics: [diagnostic] },
    });
  };

  const textAfter = (action: lsp.CodeAction) => {
    const change = action.edit!.documentChanges!.find(
      lsp.TextDocumentEdit.is,
    ) as lsp.TextDocumentEdit;
    const edit = change.edits[0] as lsp.TextEdit;
    return edit.newText;
  };

  it("offers both, the likelier first", async () => {
    const includes = await actionsFor("includePath");
    expect(includes.map((a) => a.title)).toEqual([
      expect.stringContaining("includePaths"),
      expect.stringContaining("sourceRoot"),
    ]);
    expect(includes[0].isPreferred).toBe(true);
    const roots = await actionsFor("sourceRoot");
    expect(roots[0].title).toContain("sourceRoot");
  });

  it("creates the project config when there is none", async () => {
    const [action] = await actionsFor("includePath");
    expect(action.edit!.documentChanges![0]).toMatchObject({ kind: "create" });
    expect(JSON.parse(textAfter(action))).toEqual({ includePaths: ["inc"] });
  });

  it("edits the project config that is there", async () => {
    await writeFile(
      join(dir, ".m68krc.json"),
      JSON.stringify({ processors: ["mc68020"] }),
    );
    const [action] = await actionsFor("includePath");
    expect(action.edit!.documentChanges![0]).toMatchObject({
      textDocument: {
        uri: pathToFileURL(join(dir, ".m68krc.json")).toString(),
      },
    });
    expect(JSON.parse(textAfter(action))).toEqual({
      processors: ["mc68020"],
      includePaths: ["inc"],
    });
    // Nothing is written by offering the fix.
    expect(
      JSON.parse(await readFile(join(dir, ".m68krc.json"), "utf8")),
    ).toEqual({
      processors: ["mc68020"],
    });
  });

  it("ignores other diagnostics", async () => {
    const ctx = await createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "p" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
    expect(
      new CodeActionProvider(ctx).onCodeAction({
        textDocument: { uri: "file:///x.s" },
        range: lsp.Range.create(0, 0, 0, 0),
        context: {
          diagnostics: [
            { range: lsp.Range.create(0, 0, 0, 0), message: "x", code: 1 },
          ],
        },
      }),
    ).toEqual([]);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import DocumentProcessor from "../../src/DocumentProcessor";
import MacroExpansionProvider from "../../src/providers/MacroExpansionProvider";
import { createTestContext, range } from "../helpers";

it("expands a macro from an include and follows its nested call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "m68k-macro-"));
  try {
    const ctx = await createTestContext();
    ctx.workspaceFolders = [
      { uri: pathToFileURL(directory).toString(), name: "project" },
    ];
    const includePath = join(directory, "macros.i");
    await writeFile(
      includePath,
      [
        "Inner macro",
        " moveq #\\1,\\2",
        " endm",
        "Outer macro",
        " Inner \\1,\\2",
        " endm",
      ].join("\n"),
    );
    const uri = pathToFileURL(join(directory, "main.s")).toString();
    const document = TextDocument.create(
      uri,
      "m68k",
      2,
      ' include "macros.i"\r\n Outer 7,d2',
    );
    await new DocumentProcessor(ctx).process(document);
    const provider = new MacroExpansionProvider(ctx);
    const request = {
      textDocument: { uri },
      documentVersion: 2,
      position: { line: 1, character: 10 },
    };

    expect(provider.onMacroExpansion(request)).toEqual({
      name: "Outer",
      definition: {
        uri: pathToFileURL(includePath).toString(),
        range: range(3, 0, 3, 0),
      },
      lines: ["; Inner 7,d2", " moveq #7,d2"],
      incomplete: false,
    });
    expect(
      provider.onMacroExpansion({ ...request, documentVersion: 1 }),
    ).toBeUndefined();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

it("marks recursive expansion as partial and skips ordinary instructions", async () => {
  const ctx = await createTestContext();
  const uri = ctx.workspaceFolders[0].uri + "/recursive-macro.s";
  const document = TextDocument.create(
    uri,
    "m68k",
    0,
    [
      "Recursive macro",
      " nop",
      " Recursive",
      " endm",
      " Recursive",
      " rts",
    ].join("\n"),
  );
  await new DocumentProcessor(ctx).process(document);
  const provider = new MacroExpansionProvider(ctx);
  const request = {
    textDocument: { uri },
    documentVersion: 0,
    position: { line: 4, character: 1 },
  };
  expect(provider.onMacroExpansion(request)).toMatchObject({
    lines: [" nop", "; Recursive"],
    incomplete: true,
  });
  expect(
    provider.onMacroExpansion({
      ...request,
      position: { line: 5, character: 2 },
    }),
  ).toBeUndefined();
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Connection, SemanticTokensLegend } from "vscode-languageserver";
import { SemanticTokensRefreshRequest } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import DocumentProcessor from "../../src/DocumentProcessor";
import SemanticTokensProvider from "../../src/providers/SemanticTokensProvider";
import { createTestContext } from "../helpers";

it("classifies declarations and resolved names across an assembly unit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "m68k-semantic-"));
  try {
    const ctx = await createTestContext({ caseSensitive: false });
    ctx.workspaceFolders = [
      { uri: pathToFileURL(directory).toString(), name: "project" },
    ];
    await writeFile(join(directory, "defs.i"), "COUNT equ 7\nResult equr d2\n");
    const text = [
      ' include "defs.i"',
      " macro Load",
      " moveq #\\1,d2",
      " endm",
      "Start:",
      ".loop:",
      " Load count",
      " move.w count,result",
      " bra .loop",
      " bra Start",
      " bra .missing",
      " count",
      " rts ; count",
    ];
    const uri = pathToFileURL(join(directory, "main.s")).toString();
    await new DocumentProcessor(ctx).process(
      TextDocument.create(uri, "m68k", 1, text.join("\n")),
    );
    const provider = new SemanticTokensProvider(ctx);
    const conn = { languages: { semanticTokens: { on: vi.fn() } } };
    const legend = provider.register(conn as unknown as Connection, {})
      .semanticTokensProvider?.legend;
    expect(legend).toBeDefined();
    expect(
      decode(
        provider.onSemanticTokens({ textDocument: { uri } }).data,
        text,
        legend!,
      ),
    ).toEqual([
      [1, "Load", "macro", ["declaration"]],
      [4, "Start", "label", ["declaration"]],
      [5, ".loop", "label", ["declaration"]],
      [6, "Load", "macro", []],
      [6, "count", "variable", ["readonly"]],
      [7, "count", "variable", ["readonly"]],
      [7, "result", "register", []],
      [8, ".loop", "label", []],
      [9, "Start", "label", []],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("requests one refresh after symbol kinds change for clients that support it", async () => {
  const ctx = await createTestContext();
  const provider = new SemanticTokensProvider(ctx);
  const sendRequest = vi.fn().mockResolvedValue(undefined);
  const conn = { languages: { semanticTokens: { on: vi.fn() } }, sendRequest };
  provider.register(conn as unknown as Connection, {
    workspace: { semanticTokens: { refreshSupport: true } },
  });
  const processor = new DocumentProcessor(ctx);
  const uri = ctx.workspaceFolders[0].uri + "/semantic-refresh.i";
  vi.useFakeTimers();
  try {
    await processor.process(TextDocument.create(uri, "m68k", 1, "COUNT equ 1"));
    await processor.process(TextDocument.create(uri, "m68k", 2, "COUNT set 2"));
    await vi.runAllTimersAsync();
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith(
      SemanticTokensRefreshRequest.type,
    );

    await processor.process(TextDocument.create(uri, "m68k", 3, "COUNT set 3"));
    await vi.runAllTimersAsync();
    expect(sendRequest).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

function decode(
  data: number[],
  source: string[],
  legend: SemanticTokensLegend,
) {
  let line = 0;
  let column = 0;
  const result: Array<[number, string, string, string[]]> = [];
  for (let i = 0; i < data.length; i += 5) {
    const [lineDelta, columnDelta, length, type, bits] = data.slice(i, i + 5);
    line += lineDelta;
    column = (lineDelta ? 0 : column) + columnDelta;
    result.push([
      line,
      source[line].slice(column, column + length),
      legend.tokenTypes[type],
      legend.tokenModifiers.filter((_, index) => bits & (1 << index)),
    ]);
  }
  return result;
}

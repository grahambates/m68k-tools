import type * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import DocumentProcessor from "../src/DocumentProcessor";
import DiagnosticProcessor from "../src/diagnostics";
import TextDocumentSyncProvider from "../src/providers/TextDocumentSyncProvider";
import { type Context } from "../src/context";
import { createTestContext, range } from "./helpers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const uri = "file:///diagnostic-scheduling.s";
const diagnostic = (message: string): lsp.Diagnostic => ({
  range: range(0, 0, 0, 1),
  message,
});

describe("diagnostic scheduling", () => {
  let ctx: Context;
  let sync: TextDocumentSyncProvider;
  let processor: DocumentProcessor;
  beforeEach(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    sync = new TextDocumentSyncProvider(ctx);
    await processor.process(
      TextDocument.create(uri, "m68k", 1, " move d0,d1\n"),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("drops assembly diagnostics if the editor changes before completion", async () => {
    const assembly = deferred<lsp.Diagnostic[]>();
    vi.spyOn(
      DiagnosticProcessor.prototype,
      "vasmDiagnostics",
    ).mockReturnValueOnce(assembly.promise);
    const pending = sync.fileDiagnostics(uri);
    await sync.onDidChangeTextDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: " move d2,d3\n" }],
    });
    assembly.resolve([diagnostic("old")]);
    await pending;
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledWith({
      uri,
      version: 2,
      diagnostics: [],
    });
  });

  it("publishes only the latest assembly request even at the same document version", async () => {
    const first = deferred<lsp.Diagnostic[]>();
    const second = deferred<lsp.Diagnostic[]>();
    vi.spyOn(DiagnosticProcessor.prototype, "vasmDiagnostics")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const older = sync.fileDiagnostics(uri);
    const newer = sync.fileDiagnostics(uri);
    second.resolve([diagnostic("new")]);
    await newer;
    first.resolve([diagnostic("old")]);
    await older;
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledWith({
      uri,
      version: 1,
      diagnostics: [diagnostic("new")],
    });
  });

  it("does not republish diagnostics after closing and reopening with the same version", async () => {
    const first = deferred<lsp.Diagnostic[]>();
    vi.spyOn(DiagnosticProcessor.prototype, "vasmDiagnostics")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue([]);
    const older = sync.fileDiagnostics(uri);
    await sync.onDidCloseTextDocument({ textDocument: { uri } });
    await sync.onDidOpenTextDocument({
      textDocument: {
        uri,
        languageId: "m68k",
        version: 1,
        text: " move d2,d3\n",
      },
    });
    first.resolve([diagnostic("closed")]);
    await older;
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledTimes(2);
    expect(ctx.connection.sendDiagnostics).toHaveBeenLastCalledWith({
      uri,
      version: 1,
      diagnostics: [],
    });
  });

  it("drops parser diagnostics from an older processing request", async () => {
    const gate = deferred<void>();
    const process = DocumentProcessor.prototype.process;
    vi.spyOn(DocumentProcessor.prototype, "process").mockImplementation(
      async function (this: DocumentProcessor, document) {
        const result = await process.call(this, document);
        if (document.version === 2) await gate.promise;
        return result;
      },
    );
    const older = sync.onDidChangeTextDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: " move d0,d1\n" }],
    });
    await sync.onDidChangeTextDocument({
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: " move d2,d3\n" }],
    });
    gate.resolve();
    await older;
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledWith({
      uri,
      version: 3,
      diagnostics: [],
    });
  });
});

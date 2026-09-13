import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createContext, type Context } from "../src/context";
import DocumentProcessor, { isProcessed } from "../src/DocumentProcessor";
import FileOperationsProvider from "../src/providers/FileOperationsProvider";
import TextDocumentSyncProvider from "../src/providers/TextDocumentSyncProvider";
import * as files from "../src/files";
import { NullLogger } from "./helpers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("document lifecycle", () => {
  let dir: string;
  let ctx: Context;
  let processor: DocumentProcessor;
  let operations: FileOperationsProvider;
  const uriFor = (name: string) => pathToFileURL(join(dir, name)).toString();
  const write = async (name: string, text: string) => {
    await writeFile(join(dir, name), text);
    return uriFor(name);
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-lifecycle-"));
    ctx = await createContext(
      [{ uri: uriFor(""), name: "test" }],
      new NullLogger(),
      {
        sendDiagnostics: vi.fn(),
        sendNotification: vi.fn(),
      } as unknown as lsp.Connection,
      {},
    );
    processor = new DocumentProcessor(ctx);
    operations = new FileOperationsProvider(ctx);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("releases closed syntax trees and discards unsaved symbols", async () => {
    const uri = await write("main.s", "Saved equ 1\n");
    await processor.process(
      TextDocument.create(uri, "m68k", 2, "Unsaved equ 2\n"),
    );
    await new TextDocumentSyncProvider(ctx).onDidCloseTextDocument({
      textDocument: { uri },
    });
    const closed = ctx.store.get(uri)!;
    expect(isProcessed(closed)).toBe(false);
    expect(closed.symbols.definitions.has("Saved")).toBe(true);
    expect(closed.symbols.definitions.has("Unsaved")).toBe(false);
    expect(ctx.connection.sendDiagnostics).toHaveBeenCalledWith({
      uri,
      diagnostics: [],
    });
  });

  it("removes a closed document that has no file on disk", async () => {
    const uri = uriFor("unsaved.s");
    await processor.process(
      TextDocument.create(uri, "m68k", 1, "Unsaved equ 1\n"),
    );
    await processor.close(uri);
    expect(ctx.store.has(uri)).toBe(false);
    expect(ctx.documentUpdates.has(uri)).toBe(false);
  });

  it("preserves a reopened editor when a close-time disk read finishes late", async () => {
    const uri = await write("main.s", "Saved equ 1\n");
    await processor.process(
      TextDocument.create(uri, "m68k", 1, "First equ 1\n"),
    );
    const read = deferred<TextDocument | null>();
    vi.spyOn(files, "readDocumentFromUri").mockReturnValueOnce(read.promise);
    const closing = processor.close(uri);
    const reopened = await processor.process(
      TextDocument.create(uri, "m68k", 1, "Reopened equ 2\n"),
    );
    read.resolve(TextDocument.create(uri, "m68k", 0, "Saved equ 1\n"));
    await closing;
    expect(ctx.store.get(uri)).toBe(reopened);
  });

  it("discards older disk reads and does not resurrect deleted files", async () => {
    const uri = uriFor("main.s");
    const oldRead = deferred<TextDocument | null>();
    const newRead = deferred<TextDocument | null>();
    const read = vi
      .spyOn(files, "readDocumentFromUri")
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const oldIndex = processor.index(uri);
    const newIndex = new DocumentProcessor(ctx).index(uri);
    newRead.resolve(TextDocument.create(uri, "m68k", 0, "New equ 2\n"));
    await newIndex;
    oldRead.resolve(TextDocument.create(uri, "m68k", 0, "Old equ 1\n"));
    await oldIndex;
    expect(ctx.store.get(uri)?.symbols.definitions.has("New")).toBe(true);
    const deletedRead = deferred<TextDocument | null>();
    read.mockReturnValueOnce(deletedRead.promise);
    const pending = processor.index(uri);
    processor.remove(uri);
    deletedRead.resolve(TextDocument.create(uri, "m68k", 0, "Deleted equ 3\n"));
    await pending;
    expect(ctx.store.has(uri)).toBe(false);
  });

  it("refreshes external include symbols and newly included dependencies", async () => {
    const include = await write("defs.i", "Old equ 1\n");
    const main = await write("main.s", ' include "defs.i"\n');
    await processor.index(main);
    const nested = await write("nested.i", "Nested equ 3\n");
    await write("defs.i", 'New equ 2\n include "nested.i"\n');
    await operations.onDidChangeWatchedFiles({
      changes: [{ uri: include, type: lsp.FileChangeType.Changed }],
    });
    expect(ctx.store.get(include)?.symbols.definitions.has("Old")).toBe(false);
    expect(ctx.store.get(include)?.symbols.definitions.has("New")).toBe(true);
    expect(files.getIncluded(main, ctx)).toContain(nested);
    expect(ctx.store.get(nested)?.symbols.definitions.has("Nested")).toBe(true);
    expect(ctx.connection.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ method: "m68k/indexChanged" }),
    );
  });

  it("connects previously missing includes when files are created", async () => {
    const main = await write("main.s", ' include "created.i"\n');
    await processor.index(main);
    expect(ctx.store.get(main)?.referencedUris).toEqual([]);
    const created = await write("created.i", "Created equ 1\n");
    await operations.onDidCreateFiles({ files: [{ uri: created }] });
    expect(ctx.store.get(main)?.referencedUris).toEqual([created]);
    expect(ctx.store.get(created)?.symbols.definitions.has("Created")).toBe(
      true,
    );
  });

  it("removes deleted include symbols and leaves dense include edges", async () => {
    const removed = await write("removed.i", "Removed equ 1\n");
    const kept = await write("kept.i", "Kept equ 1\n");
    const main = await write(
      "main.s",
      ' include "removed.i"\n include "kept.i"\n',
    );
    await processor.index(main);
    await rm(join(dir, "removed.i"));
    await operations.onDidChangeWatchedFiles({
      changes: [{ uri: removed, type: lsp.FileChangeType.Deleted }],
    });
    expect(ctx.store.has(removed)).toBe(false);
    expect(ctx.store.get(main)?.referencedUris).toEqual([kept]);
    expect(files.getIncluded(main, ctx)).toEqual([kept]);
  });

  it.each([lsp.FileChangeType.Changed, lsp.FileChangeType.Deleted] as const)(
    "preserves unsaved editor content on external event %s",
    async (type) => {
      const uri = await write("main.s", "Saved equ 1\n");
      const opened = await processor.process(
        TextDocument.create(uri, "m68k", 2, "Unsaved equ 2\n"),
      );
      if (type === lsp.FileChangeType.Deleted) await rm(join(dir, "main.s"));
      await operations.onDidChangeWatchedFiles({ changes: [{ uri, type }] });
      expect(ctx.store.get(uri)).toBe(opened);
      expect(ctx.store.get(uri)?.symbols.definitions.has("Unsaved")).toBe(true);
    },
  );

  it("ignores excluded files reported by the watcher", async () => {
    await mkdir(join(dir, "build"));
    const uri = await write("build/generated.s", "Generated equ 1\n");
    await operations.onDidChangeWatchedFiles({
      changes: [{ uri, type: lsp.FileChangeType.Created }],
    });
    expect(ctx.store.has(uri)).toBe(false);
  });
});

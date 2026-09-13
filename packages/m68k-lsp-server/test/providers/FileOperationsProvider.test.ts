import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { createContext } from "../../src/context";
import RenameProvider from "../../src/providers/RenameProvider";
import { isProcessed } from "../../src/DocumentProcessor";
import type * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import FileOperationsProvider from "../../src/providers/FileOperationsProvider";
import { createTestContext, NullLogger } from "../helpers";

describe("FileOperationsProvider", () => {
  let provider: FileOperationsProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new FileOperationsProvider(ctx);
  });

  // Create and process text doc
  const createDoc = async (filename: string, text: string) => {
    const uri = ctx.workspaceFolders[0].uri + "/" + filename;
    const textDocument = TextDocument.create(uri, "vasmmot", 0, text);
    await processor.process(textDocument);
    return textDocument;
  };

  describe("#register()", () => {
    it("regsiters", () => {
      const conn = {
        workspace: {
          onWillDeleteFiles: vi.fn(),
          onDidDeleteFiles: vi.fn(),
          onDidRenameFiles: vi.fn(),
          onDidCreateFiles: vi.fn(),
        },
      };
      Object.assign(conn, { onDidChangeWatchedFiles: vi.fn() });
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.workspace.onWillDeleteFiles).toHaveBeenCalled();
      expect(conn.workspace.onDidDeleteFiles).toHaveBeenCalled();
      expect(conn.workspace.onDidRenameFiles).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("workspace");
    });
  });

  describe("#onDidOpenTextDocument()", () => {
    it("deletes a document from store", async () => {
      const doc = await createDoc("example.s", ` move d0,d1`);

      await provider.onWillDeleteFiles({
        files: [{ uri: doc.uri }],
      });
      await provider.onDidDeleteFiles({
        files: [{ uri: doc.uri }],
      });

      expect(ctx.store.get(doc.uri)).toBeFalsy();
    });

    it("deletes documents in a directory from store", async () => {
      const doc = await createDoc("a/b.s", ` move d0,d1`);
      const dirUri = ctx.workspaceFolders[0].uri + "/a";

      await provider.onWillDeleteFiles({
        files: [{ uri: dirUri }],
      });
      await provider.onDidDeleteFiles({
        files: [{ uri: dirUri }],
      });

      expect(ctx.store.get(doc.uri)).toBeFalsy();
    });

    it("deletes documents in a directory from store", async () => {
      const referencing = await createDoc("example.s", ` include "example.i"`);
      const referenced = ctx.workspaceFolders[0].uri + "/example.i";

      await provider.onWillDeleteFiles({
        files: [{ uri: referenced }],
      });
      await provider.onDidDeleteFiles({
        files: [{ uri: referenced }],
      });

      const stored = ctx.store.get(referencing.uri);
      expect(stored).toBeTruthy();
      expect(stored!.referencedUris).not.toContain(referenced);
    });
  });

  describe("#onDidRenameFiles()", () => {
    it("renames a file", async () => {
      const doc = await createDoc("a/b.s", ` move d0,d1`);
      const newUri = doc.uri.replace("a/b.s", "example.s");

      await provider.onDidRenameFiles({
        files: [{ oldUri: doc.uri, newUri }],
      });

      expect(ctx.store.has(doc.uri)).toBeFalsy();
      expect(ctx.store.has(newUri)).toBeTruthy();
    });

    it("renames a directory", async () => {
      const doc = await createDoc("a/b.s", ` move d0,d1`);

      const oldUri = ctx.workspaceFolders[0].uri + "/a";
      const newUri = ctx.workspaceFolders[0].uri + "/b";

      await provider.onDidRenameFiles({
        files: [{ oldUri, newUri }],
      });

      expect(ctx.store.has(doc.uri)).toBeFalsy();
      expect(ctx.store.has(newUri + "/b.s")).toBeTruthy();
    });
  });
});

describe("file rename locations", () => {
  let dir: string;
  let ctx: Context;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m68k-rename-"));
    ctx = await createContext(
      [{ uri: pathToFileURL(dir).toString(), name: "rename" }],
      new NullLogger(),
      {} as lsp.Connection,
      {},
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([true, false])(
    "relocates all symbol locations (open=%s)",
    async (open) => {
      const oldUri = pathToFileURL(join(dir, "old.s")).toString();
      const newUri = pathToFileURL(join(dir, "new.s")).toString();
      const text =
        'Start:\n.local:\n bra .local\n bra Start\n include "defs.i"\n incdir "include"\n';
      await writeFile(join(dir, "old.s"), text);
      await writeFile(join(dir, "new.s"), text);
      const processor = new DocumentProcessor(ctx);
      if (open) {
        await processor.process(
          TextDocument.create(oldUri, "m68k", 3, text + "; unsaved\n"),
        );
      } else {
        await processor.index(oldUri);
      }
      await new FileOperationsProvider(ctx).onDidRenameFiles({
        files: [{ oldUri, newUri }],
      });
      const document = ctx.store.get(newUri)!;
      const symbols = document.symbols;
      expect(symbols.definitions.get("Start")?.location.uri).toBe(newUri);
      expect(
        symbols.definitions.get("Start")?.locals?.get(".local")?.location.uri,
      ).toBe(newUri);
      expect(
        [...symbols.references.values()]
          .flat()
          .every((ref) => ref.location.uri === newUri),
      ).toBe(true);
      expect(
        [...symbols.includes, ...symbols.incDirs].every(
          (ref) => ref.location.uri === newUri,
        ),
      ).toBe(true);
      const edits = await new RenameProvider(ctx).onRenameRequest({
        textDocument: { uri: newUri },
        position: { line: 0, character: 1 },
        newName: "Renamed",
      });
      expect(Object.keys(edits.changes!)).toEqual([newUri]);
      if (isProcessed(document)) {
        expect(document.document.version).toBe(3);
        expect(document.document.getText()).toBe(text + "; unsaved\n");
      }
    },
  );

  it("preserves nested relative paths when renaming a folder", async () => {
    await mkdir(join(dir, "new", "nested"), { recursive: true });
    const text = "Start:\n rts\n";
    await writeFile(join(dir, "new", "same.s"), text);
    await writeFile(join(dir, "new", "nested", "same.s"), text);
    const oldUri = pathToFileURL(join(dir, "old")).toString();
    const newUri = pathToFileURL(join(dir, "new")).toString();
    const processor = new DocumentProcessor(ctx);
    for (const relative of ["/same.s", "/nested/same.s"]) {
      await processor.process(
        TextDocument.create(oldUri + relative, "m68k", 0, text),
      );
    }
    await new FileOperationsProvider(ctx).onDidRenameFiles({
      files: [{ oldUri, newUri }],
    });
    for (const relative of ["/same.s", "/nested/same.s"]) {
      expect(ctx.store.has(oldUri + relative)).toBe(false);
      expect(
        ctx.store.get(newUri + relative)?.symbols.definitions.get("Start")
          ?.location.uri,
      ).toBe(newUri + relative);
    }
  });
});

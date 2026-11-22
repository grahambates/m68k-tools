import { mkdtemp, mkdir, rename, rm, writeFile } from "fs/promises";
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
import { applyEdits, createTestContext, NullLogger } from "../helpers";

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
          onWillRenameFiles: vi.fn(),
          onDidDeleteFiles: vi.fn(),
          onDidRenameFiles: vi.fn(),
          onDidCreateFiles: vi.fn(),
        },
      };
      Object.assign(conn, { onDidChangeWatchedFiles: vi.fn() });
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.workspace.onWillDeleteFiles).toHaveBeenCalled();
      expect(conn.workspace.onWillRenameFiles).toHaveBeenCalled();
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

  it("rewrites a literal include from an unsaved buffer and reindexes the moved include", async () => {
    const mainUri = pathToFileURL(join(dir, "main.s")).toString();
    const oldPath = join(dir, "defs.i");
    const newPath = join(dir, "new defs.inc");
    const oldUri = pathToFileURL(oldPath).toString();
    const newUri = pathToFileURL(newPath).toString();
    await writeFile(oldPath, "Count equ 3\n");
    await writeFile(join(dir, "main.s"), " nop\n");
    const original = " include 'defs.i' ; keep this\n include missing.i\n";
    const processor = new DocumentProcessor(ctx);
    await processor.process(TextDocument.create(mainUri, "m68k", 3, original));
    const provider = new FileOperationsProvider(ctx);
    const files = [{ oldUri, newUri }];
    const edits = await provider.onWillRenameFiles({ files });
    expect(edits?.changes?.[mainUri]).toHaveLength(1);
    const updated = applyEdits(original, edits!.changes![mainUri]);
    expect(updated).toBe(
      " include 'new defs.inc' ; keep this\n include missing.i\n",
    );
    await processor.process(TextDocument.create(mainUri, "m68k", 4, updated));
    await rename(oldPath, newPath);
    await provider.onDidRenameFiles({ files });
    expect(ctx.store.get(mainUri)?.referencedUris).toEqual([newUri]);
    expect(ctx.store.get(newUri)?.symbols.definitions.has("Count")).toBe(true);
    expect(ctx.store.has(oldUri)).toBe(false);
  });

  it("adds quotes when a renamed target has spaces", async () => {
    const original = " include defs.i\n";
    const main = join(dir, "main.s");
    await writeFile(main, original);
    await writeFile(join(dir, "defs.i"), "Count equ 3\n");
    const uri = pathToFileURL(main).toString();
    await new DocumentProcessor(ctx).index(uri);
    const edits = await new FileOperationsProvider(ctx).onWillRenameFiles({
      files: [
        {
          oldUri: pathToFileURL(join(dir, "defs.i")).toString(),
          newUri: pathToFileURL(join(dir, "new defs.i")).toString(),
        },
      ],
    });
    expect(applyEdits(original, edits!.changes![uri])).toBe(
      ' include "new defs.i"\n',
    );
  });

  it("repairs includes in the moved entry point and its nested includer", async () => {
    await mkdir(join(dir, "old", "sub"), { recursive: true });
    await mkdir(join(dir, "new"));
    const main = join(dir, "old", "main.s");
    const nested = join(dir, "old", "sub", "nested.i");
    const mainText = ' include "sub/nested.i"\n';
    const nestedText = ' include "defs.i"\n';
    await writeFile(main, mainText);
    await writeFile(nested, nestedText);
    await writeFile(join(dir, "old", "defs.i"), "Count equ 3\n");
    const uri = pathToFileURL(main).toString();
    const nestedUri = pathToFileURL(nested).toString();
    const processor = new DocumentProcessor(ctx);
    await processor.index(uri);
    await processor.settleIncludes();
    const edits = await new FileOperationsProvider(ctx).onWillRenameFiles({
      files: [
        {
          oldUri: uri,
          newUri: pathToFileURL(join(dir, "new", "main.s")).toString(),
        },
      ],
    });
    expect(applyEdits(mainText, edits!.changes![uri])).toBe(
      ' include "../old/sub/nested.i"\n',
    );
    expect(applyEdits(nestedText, edits!.changes![nestedUri])).toBe(
      ' include "../old/defs.i"\n',
    );
  });

  it("preserves paths when a project and its relative config move together", async () => {
    const project = join(dir, "old");
    await mkdir(join(project, "source"), { recursive: true });
    await mkdir(join(project, "headers"));
    await writeFile(
      join(project, ".m68krc.json"),
      '{"sourceRoot":".","includePaths":["headers"]}',
    );
    await writeFile(join(project, "headers", "defs.i"), "Count equ 3\n");
    const main = join(project, "source", "main.s");
    await writeFile(main, ' include "defs.i"\n');
    await new DocumentProcessor(ctx).index(pathToFileURL(main).toString());
    const edits = await new FileOperationsProvider(ctx).onWillRenameFiles({
      files: [
        {
          oldUri: pathToFileURL(project).toString(),
          newUri: pathToFileURL(join(dir, "new")).toString(),
        },
      ],
    });
    expect(edits).toBeNull();
  });

  it("does not choose a replacement name that is shadowed earlier in vasm's search", async () => {
    await mkdir(join(dir, "headers"));
    await writeFile(join(dir, ".m68krc.json"), '{"includePaths":["headers"]}');
    await writeFile(join(dir, "headers", "old.i"), "Count equ 3\n");
    await writeFile(join(dir, "new.i"), "Other equ 5\n");
    const main = join(dir, "main.s");
    const original = ' include "old.i"\n';
    await writeFile(main, original);
    const uri = pathToFileURL(main).toString();
    await new DocumentProcessor(ctx).index(uri);
    const edits = await new FileOperationsProvider(ctx).onWillRenameFiles({
      files: [
        {
          oldUri: pathToFileURL(join(dir, "headers", "old.i")).toString(),
          newUri: pathToFileURL(join(dir, "headers", "new.i")).toString(),
        },
      ],
    });
    expect(applyEdits(original, edits!.changes![uri])).toBe(
      ' include "headers/new.i"\n',
    );
  });

  it.each([false, true])(
    "updates an incbin path without indexing the asset (folder move=%s)",
    async (folderMove) => {
      const assets = join(dir, "assets");
      await mkdir(assets);
      const asset = join(assets, "data.bin");
      await writeFile(asset, Buffer.from([0, 0xff, 0x7f, 0x42]));
      const source = join(dir, "main.s");
      const original =
        "Start equ 1\n incbin assets/data.bin,Start,2 ; asset slice\n";
      await writeFile(source, original);
      const uri = pathToFileURL(source).toString();
      const processor = new DocumentProcessor(ctx);
      await processor.index(uri);
      const oldPath = folderMove ? assets : asset;
      const newPath = folderMove
        ? join(dir, "new assets")
        : join(assets, "new data.bin");
      const edits = await new FileOperationsProvider(ctx).onWillRenameFiles({
        files: [
          {
            oldUri: pathToFileURL(oldPath).toString(),
            newUri: pathToFileURL(newPath).toString(),
          },
        ],
      });
      const path = folderMove ? "new assets/data.bin" : "assets/new data.bin";
      expect(applyEdits(original, edits!.changes![uri])).toBe(
        `Start equ 1\n incbin "${path}",Start,2 ; asset slice\n`,
      );
      expect(ctx.store.get(uri)?.referencedUris).toEqual([]);
      expect(ctx.store.get(uri)?.symbols.references.get("Start")).toHaveLength(
        1,
      );
      expect(ctx.store.has(pathToFileURL(asset).toString())).toBe(false);
    },
  );

  it("leaves shared include text alone when two programs resolve it differently", async () => {
    for (const project of ["a", "b"]) {
      await mkdir(join(dir, project));
      await writeFile(join(dir, project, "main.s"), ' include "../shared.i"\n');
      await writeFile(join(dir, project, "defs.i"), "Count equ 3\n");
    }
    await writeFile(join(dir, "shared.i"), ' include "defs.i"\n');
    const processor = new DocumentProcessor(ctx);
    for (const project of ["a", "b"]) {
      await processor.index(
        pathToFileURL(join(dir, project, "main.s")).toString(),
      );
    }
    await processor.settleIncludes();
    const edits = await new FileOperationsProvider(ctx).onWillRenameFiles({
      files: [
        {
          oldUri: pathToFileURL(join(dir, "a", "defs.i")).toString(),
          newUri: pathToFileURL(join(dir, "a", "renamed.i")).toString(),
        },
      ],
    });
    expect(edits).toBeNull();
  });
});

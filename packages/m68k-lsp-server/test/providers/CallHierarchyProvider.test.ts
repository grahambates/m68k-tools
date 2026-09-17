import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import CallHierarchyProvider from "../../src/providers/CallHierarchyProvider";
import { createTestContext, range } from "../helpers";

describe("CallHierarchyProvider", () => {
  let provider: CallHierarchyProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new CallHierarchyProvider(ctx);
  });

  // Create and process text doc
  const createDoc = async (filename: string, text: string) => {
    const uri = ctx.workspaceFolders[0].uri + "/" + filename;
    const textDocument = TextDocument.create(uri, "vasmmot", 0, text);
    await processor.process(textDocument);
    return textDocument;
  };

  const prepare = async (
    textDocument: TextDocument,
    position: lsp.Position,
  ) => {
    const items = await provider.onPrepare({ textDocument, position });
    return items?.[0];
  };

  describe("#register()", () => {
    it("registers", () => {
      const conn = {
        languages: {
          callHierarchy: {
            onPrepare: vi.fn(),
            onIncomingCalls: vi.fn(),
            onOutgoingCalls: vi.fn(),
          },
        },
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.languages.callHierarchy.onPrepare).toHaveBeenCalled();
      expect(conn.languages.callHierarchy.onIncomingCalls).toHaveBeenCalled();
      expect(conn.languages.callHierarchy.onOutgoingCalls).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("callHierarchyProvider");
    });
  });

  describe("#onPrepare()", () => {
    it("resolves an item from a global label definition", async () => {
      const textDocument = await createDoc(
        "prepare-def.s",
        `main:
 bsr helper
helper:
 rts`,
      );

      const item = await prepare(textDocument, lsp.Position.create(0, 1));

      expect(item).toMatchObject({
        name: "main",
        kind: lsp.SymbolKind.Function,
        uri: textDocument.uri,
        selectionRange: range(0, 0, 0, 4),
      });
    });

    it("resolves an item from a call site", async () => {
      const textDocument = await createDoc(
        "prepare-call.s",
        `main:
 bsr helper
helper:
 rts`,
      );

      const item = await prepare(textDocument, lsp.Position.create(1, 7));

      expect(item).toMatchObject({
        name: "helper",
        selectionRange: range(2, 0, 2, 6),
      });
    });

    it("returns null for a local label", async () => {
      const textDocument = await createDoc(
        "prepare-local.s",
        `main:
.loop
 dbf d0,.loop`,
      );

      const item = await prepare(textDocument, lsp.Position.create(1, 2));

      expect(item).toBeUndefined();
    });

    it("returns null when there is no symbol at the position", async () => {
      const textDocument = await createDoc("prepare-empty.s", `main:\n`);

      const item = await prepare(textDocument, lsp.Position.create(1, 0));

      expect(item).toBeUndefined();
    });
  });

  describe("#onOutgoingCalls()", () => {
    it("groups repeated calls to the same target and lists other targets separately", async () => {
      const textDocument = await createDoc(
        "outgoing.s",
        `main:
 bsr helper
 bsr helper
 bsr other
 jsr (a0)
helper:
 rts
other:
 rts`,
      );

      const item = await prepare(textDocument, lsp.Position.create(0, 1));
      const calls = await provider.onOutgoingCalls({ item: item! });

      expect(calls).toHaveLength(2);

      const toHelper = calls!.find((c) => c.to.name === "helper");
      expect(toHelper?.fromRanges).toEqual([
        range(1, 5, 1, 11),
        range(2, 5, 2, 11),
      ]);

      const toOther = calls!.find((c) => c.to.name === "other");
      expect(toOther?.fromRanges).toEqual([range(3, 5, 3, 10)]);
    });

    it("ignores calls with no resolvable target, such as register-indirect jsr", async () => {
      const textDocument = await createDoc(
        "outgoing-indirect.s",
        `main:
 jsr (a0)
 rts`,
      );

      const item = await prepare(textDocument, lsp.Position.create(0, 1));
      const calls = await provider.onOutgoingCalls({ item: item! });

      expect(calls).toEqual([]);
    });

    it("resolves a target defined in an included file", async () => {
      const textDocument = await createDoc(
        "outgoing-cross.s",
        ` include "call-hierarchy.i"
main:
 bsr helper`,
      );

      const item = await prepare(textDocument, lsp.Position.create(1, 1));
      const calls = await provider.onOutgoingCalls({ item: item! });

      expect(calls).toHaveLength(1);
      expect(calls![0].to).toMatchObject({
        name: "helper",
        uri: expect.stringContaining("call-hierarchy.i"),
      });
    });
  });

  describe("#onIncomingCalls()", () => {
    it("groups repeated calls from the same caller and lists other callers separately", async () => {
      const textDocument = await createDoc(
        "incoming.s",
        `main:
 bsr helper
 bsr helper
other:
 bsr helper
helper:
 rts`,
      );

      const item = await prepare(textDocument, lsp.Position.create(5, 1));
      const calls = await provider.onIncomingCalls({ item: item! });

      expect(calls).toHaveLength(2);

      const fromMain = calls!.find((c) => c.from.name === "main");
      expect(fromMain?.fromRanges).toEqual([
        range(1, 5, 1, 11),
        range(2, 5, 2, 11),
      ]);

      const fromOther = calls!.find((c) => c.from.name === "other");
      expect(fromOther?.fromRanges).toEqual([range(4, 5, 4, 11)]);
    });

    it("spans every unit that includes the defining file", async () => {
      await createDoc(
        "sibling-b.s",
        ` include "call-hierarchy.i"
callerB:
 bsr helper`,
      );
      const unitA = await createDoc(
        "sibling-a.s",
        ` include "call-hierarchy.i"
callerA:
 bsr helper`,
      );

      const item = await prepare(unitA, lsp.Position.create(2, 5));
      const calls = await provider.onIncomingCalls({ item: item! });

      const callerNames = calls!.map((c) => c.from.name);
      expect(callerNames).toEqual(
        expect.arrayContaining(["callerA", "callerB"]),
      );
    });
  });
});

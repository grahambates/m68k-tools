import * as lsp from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { type Context } from "../../src/context";
import DocumentProcessor from "../../src/DocumentProcessor";
import SignatureHelpProvider from "../../src/providers/SignatureHelpProvider";
import { createTestContext } from "../helpers";

describe("SignatureHelpProvider", () => {
  let provider: SignatureHelpProvider;
  let ctx: Context;
  let processor: DocumentProcessor;

  beforeAll(async () => {
    ctx = await createTestContext();
    processor = new DocumentProcessor(ctx);
    provider = new SignatureHelpProvider(ctx);
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
        onSignatureHelp: vi.fn(),
      };
      const capabilities = provider.register(conn as unknown as lsp.Connection);
      expect(conn.onSignatureHelp).toHaveBeenCalled();
      expect(capabilities).toHaveProperty("signatureHelpProvider");
    });
  });

  describe("#onSignatureHelp()", () => {
    it("provides help for an instruction", async () => {
      const textDocument = await createDoc("example.s", ` move `);

      const help = await provider.onSignatureHelp({
        position: lsp.Position.create(0, 6),
        textDocument,
      });

      expect(help).toBeTruthy();
      expect(help!.signatures).toContainEqual(
        expect.objectContaining({
          label: "move[.(bwl)] <source>,<destination>",
        }),
      );
    });

    it("provides help for a directive", async () => {
      const textDocument = await createDoc("example.s", ` section `);

      const help = await provider.onSignatureHelp({
        position: lsp.Position.create(0, 9),
        textDocument,
      });

      expect(help).toBeTruthy();
      expect(help!.signatures).toContainEqual(
        expect.objectContaining({
          label: "section <name>[,<sec_type>][,<mem_type>]",
        }),
      );
    });

    // TODO: more coverage needed
  });
});

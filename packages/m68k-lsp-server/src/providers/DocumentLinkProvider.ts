import * as lsp from "vscode-languageserver";
import { URI } from "vscode-uri";
import { type Provider } from ".";
import { resolveInclude } from "../files";
import { type Context } from "../context";

export default class DocumentLinkProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onDocumentLinks({
    textDocument: { uri },
  }: lsp.DocumentLinkParams): Promise<lsp.DocumentLink[] | undefined> {
    return this.ctx.store
      .get(uri)
      ?.symbols.includes.map((i) =>
        lsp.DocumentLink.create(i.location.range, "", { path: i.text, uri }),
      );
  }

  async onDocumentLinkResolve(
    item: lsp.DocumentLink,
  ): Promise<lsp.DocumentLink> {
    const { path, uri } = item.data;
    const resolved = await resolveInclude(uri, path, this.ctx);
    if (resolved) {
      item.target = URI.file(resolved).toString();
    }
    return item;
  }

  register(connection: lsp.Connection) {
    connection.onDocumentLinks(this.onDocumentLinks.bind(this));
    connection.onDocumentLinkResolve(this.onDocumentLinkResolve.bind(this));
    return {
      documentLinkProvider: {
        resolveProvider: true,
      },
    };
  }
}

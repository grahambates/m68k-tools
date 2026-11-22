import type { MacroExpansionResult } from "@m68k-lsp/protocol";
import {
  DocumentLink,
  Range,
  Uri,
  ViewColumn,
  languages,
  window,
  workspace,
} from "vscode";

const scheme = "m68k-macro-expansion";

export class MacroPreview {
  private readonly previews = new Map<string, MacroExpansionResult>();
  private nextId = 0;

  register() {
    return [
      workspace.registerTextDocumentContentProvider(scheme, {
        provideTextDocumentContent: (uri) => {
          const preview = this.previews.get(uri.query);
          if (!preview) return "";
          const header = this.definitionHeader(preview);
          const notes = preview.incomplete
            ? [
                "; Expansion is partial. Some source lines may be missing or unexpanded.",
              ]
            : [];
          return [header, ...notes, "", ...preview.lines, ""].join("\n");
        },
      }),
      languages.registerDocumentLinkProvider(
        { scheme },
        {
          provideDocumentLinks: (document) => {
            const preview = this.previews.get(document.uri.query);
            if (!preview) return [];
            const line = preview.definition.range.start.line + 1;
            const target = Uri.parse(preview.definition.uri).with({
              fragment: `L${line}`,
            });
            return [
              new DocumentLink(
                new Range(0, 2, 0, this.definitionHeader(preview).length),
                target,
              ),
            ];
          },
        },
      ),
      workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === scheme)
          this.previews.delete(document.uri.query);
      }),
    ];
  }

  async show(preview: MacroExpansionResult) {
    const id = String(this.nextId++);
    const name = preview.name.replace(/[\\/:]/g, "_");
    const uri = Uri.from({ scheme, path: `/${name} expansion.asm`, query: id });
    this.previews.set(id, preview);
    try {
      const document = await workspace.openTextDocument(uri);
      await window.showTextDocument(document, ViewColumn.Beside);
    } catch (error) {
      this.previews.delete(id);
      throw error;
    }
  }

  private definitionHeader(preview: MacroExpansionResult) {
    const filename = Uri.parse(preview.definition.uri).path.split("/").at(-1);
    const line = preview.definition.range.start.line + 1;
    return `; Definition: ${filename}:${line}`;
  }
}

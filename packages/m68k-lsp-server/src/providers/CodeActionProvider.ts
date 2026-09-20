import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import * as lsp from "vscode-languageserver";
import { URI } from "vscode-uri";
import {
  editAssemblyConfig,
  findAssemblyConfigSync,
  type ConfigChange,
} from "@m68k-lsp/assembly-options";
import { type Provider } from ".";
import { type Context } from "../context";

interface InferredData {
  dir: string;
  kind: "sourceRoot" | "includePath";
  name: string;
}

/**
 * Quick fixes for the note that an include was only found through a guessed
 * directory: make the guess permanent, as the project config's `includePaths`
 * or its `sourceRoot`. Which one is meant cannot be known, so both are offered,
 * the likelier first.
 */
export default class CodeActionProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  onCodeAction({ context }: lsp.CodeActionParams): lsp.CodeAction[] {
    const actions: lsp.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== "inferred-include-path") continue;
      const data = diagnostic.data as InferredData | undefined;
      if (!data) continue;

      const choices: [ConfigChange, string][] = [
        [{ includePath: data.dir }, `Add "${data.dir}" to includePaths`],
        [{ sourceRoot: data.dir }, `Set sourceRoot to "${data.dir}"`],
      ];
      if (data.kind === "sourceRoot") choices.reverse();

      choices.forEach(([change, title], index) => {
        const edit = this.configEdit(change);
        if (!edit) return;
        actions.push({
          title,
          kind: lsp.CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: index === 0,
          edit,
        });
      });
    }
    return actions;
  }

  /** The edit that makes a change in the project config, creating it if there is none. */
  private configEdit(change: ConfigChange): lsp.WorkspaceEdit | undefined {
    const folder = this.ctx.workspaceFolders[0];
    if (!folder) return undefined;
    const folderPath = URI.parse(folder.uri).fsPath;
    const existing = findAssemblyConfigSync(folderPath);
    const path = existing ?? join(folderPath, ".m68krc.json");
    const configDir = dirname(path);
    const text =
      existing && existsSync(existing)
        ? readFileSync(existing, "utf8")
        : undefined;
    const updated = editAssemblyConfig(text, change, configDir);
    if (updated === undefined) return undefined;

    const uri = URI.file(path).toString();
    if (text === undefined)
      return {
        documentChanges: [
          lsp.CreateFile.create(uri, { ignoreIfExists: true }),
          lsp.TextDocumentEdit.create({ uri, version: null }, [
            lsp.TextEdit.insert(lsp.Position.create(0, 0), updated),
          ]),
        ],
      };

    const lines = text.split("\n");
    const end = lsp.Position.create(
      lines.length - 1,
      lines[lines.length - 1].length,
    );
    return {
      documentChanges: [
        lsp.TextDocumentEdit.create({ uri, version: null }, [
          lsp.TextEdit.replace(
            lsp.Range.create(lsp.Position.create(0, 0), end),
            updated,
          ),
        ]),
      ],
    };
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.onCodeAction(this.onCodeAction.bind(this));
    return {
      codeActionProvider: { codeActionKinds: [lsp.CodeActionKind.QuickFix] },
    };
  }
}

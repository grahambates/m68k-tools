import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import {
  CodeActionKind,
  CreateFile,
  Position,
  TextDocumentEdit,
  TextEdit,
  type CodeAction,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import {
  addIgnoreToConfigText,
  configFileNames,
  newConfigText,
} from "m68k-lint/project-config";

/** The single edit that turns `before` into `after`, leaving the common ends alone. */
export function minimalEdit(before: string, after: string): TextEdit {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  const document = TextDocument.create("file:///config", "json", 0, before);
  return TextEdit.replace(
    {
      start: document.positionAt(start),
      end: document.positionAt(endBefore),
    },
    after.slice(start, endAfter),
  );
}

const slashed = (path: string) => path.split(sep).join("/");

export interface IgnoreFileContext {
  /** The file to ignore. */
  fsPath: string;
  /** The project config that applies to it, if there is one. */
  configPath?: string;
  /**
   * The workspace root a new config would be created in if there is none.
   * Undefined for a file outside every workspace folder, a shared include say,
   * where creating a config would write into a directory the project does not own.
   */
  root?: string;
  /** Whether the client can create a file as part of an edit. */
  canCreateFiles: boolean;
  /** Text of a config file the editor has open, which may be ahead of the disk. */
  openText(uri: string): string | undefined;
}

/**
 * A code action that stops a file being linted by listing it in the project's
 * config, creating one if there is none.
 *
 * Undefined where it cannot be offered: the config is not something this can
 * edit safely, the file lies outside the config's directory, or there is no
 * config and the client cannot create one.
 */
export async function ignoreFileAction(
  context: IgnoreFileContext,
): Promise<CodeAction | undefined> {
  const { fsPath, configPath } = context;

  if (configPath) {
    const entry = slashed(relative(dirname(configPath), fsPath));
    if (entry.startsWith("..")) return undefined;
    const uri = URI.file(configPath).toString();
    let text: string;
    try {
      text = context.openText(uri) ?? (await readFile(configPath, "utf8"));
    } catch {
      return undefined;
    }
    const updated = addIgnoreToConfigText(text, entry);
    if (updated === undefined || updated === text) return undefined;
    return {
      title: `Ignore this file in ${basename(configPath)}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [],
      edit: { changes: { [uri]: [minimalEdit(text, updated)] } },
    };
  }

  if (!context.canCreateFiles || !context.root) return undefined;
  const entry = slashed(relative(context.root, fsPath));
  if (entry.startsWith("..")) return undefined;
  const name = configFileNames[0];
  const uri = URI.file(join(context.root, name)).toString();
  return {
    title: `Ignore this file (creates ${name})`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [],
    edit: {
      documentChanges: [
        CreateFile.create(uri, { ignoreIfExists: true }),
        TextDocumentEdit.create({ uri, version: null }, [
          TextEdit.insert(Position.create(0, 0), newConfigText(entry)),
        ]),
      ],
    },
  };
}

import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveInclude,
  vasmSearchDirectories,
} from "@m68k-lsp/assembly-options";
import { parseLine } from "m68k-parser";
import { URI } from "vscode-uri";
import {
  Range,
  TextDocumentEdit,
  TextEdit,
  type FileRename,
} from "vscode-languageserver";
import type { Context } from "./context";
import { isProcessed } from "./DocumentProcessor";
import {
  getEntryPoints,
  getIncluded,
  includeSearch,
  readDocumentFromUri,
  workspacePaths,
} from "./files";
import { processPath } from "./symbols";

function relativeWithin(parent: string, child: string): string | undefined {
  const suffix = relative(parent, child);
  if (suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix))
    return suffix;
}

function pathMapper(entries: [string, string][]) {
  const longestFirst = entries.sort(([a], [b]) => b.length - a.length);
  return (path: string) => {
    for (const [from, to] of longestFirst) {
      const suffix = relativeWithin(from, path);
      if (suffix !== undefined) return resolve(to, suffix);
    }
    return path;
  };
}

export function projectFileRenames(files: readonly FileRename[]) {
  const moves = files.flatMap(({ oldUri, newUri }): [string, string][] =>
    oldUri.startsWith("file:") &&
    newUri.startsWith("file:") &&
    oldUri !== newUri
      ? [[fileURLToPath(oldUri), fileURLToPath(newUri)]]
      : [],
  );
  if (!moves.length) return;
  const afterMove = pathMapper(moves);
  const reverseMove = pathMapper(moves.map(([from, to]) => [to, from]));
  const beforeMove = (path: string) => {
    const previous = reverseMove(path);
    if (previous !== path) return previous;
    return afterMove(path) === path ? path : undefined;
  };
  const moveUri = (uri: string) => {
    if (!uri.startsWith("file:")) return uri;
    const path = fileURLToPath(uri);
    const target = afterMove(path);
    return target !== path ? URI.file(target).toString() : uri;
  };
  return { afterMove, beforeMove, moveUri };
}

export async function includeRenameEdits(
  files: readonly FileRename[],
  ctx: Context,
): Promise<TextDocumentEdit[]> {
  const renames = projectFileRenames(files);
  if (!renames) return [];
  const { afterMove, beforeMove, moveUri } = renames;
  const projected = {
    workspaceFolders: ctx.workspaceFolders.map(({ name, uri }) => ({
      name,
      uri: moveUri(uri),
    })),
    config: ctx.config,
    documentConfigs: ctx.documentConfigs.project(beforeMove),
    store: new Map(
      Array.from(ctx.store, ([uri, doc]) => {
        const moved = moveUri(uri);
        return [
          moved,
          {
            ...doc,
            uri: moved,
            referencedUris: doc.referencedUris.map(moveUri),
          },
        ];
      }),
    ),
  };
  // A moved entry point changes where its nested includes are looked up,
  // even when neither the nested file nor its own include target moved.
  const affected = new Set<string>();
  for (const uri of getEntryPoints(ctx)) {
    if (moveUri(uri) === uri) continue;
    for (const included of getIncluded(uri, ctx)) affected.add(included);
  }
  for (const [uri, doc] of ctx.store) {
    if (moveUri(uri) !== uri) affected.add(uri);
    if (doc.referencedUris.some((ref) => moveUri(ref) !== ref))
      affected.add(uri);
  }
  const roots = workspacePaths(ctx);
  const present = fileFinder((path) => path);
  const future = fileFinder(beforeMove);
  const changes = await Promise.all(
    Array.from(affected, async (uri) => {
      const doc = ctx.store.get(uri);
      if (!doc?.symbols.includes.length || !uri.startsWith("file:")) return;
      if (
        roots.length &&
        !roots.some(
          (root) => relativeWithin(root, fileURLToPath(uri)) !== undefined,
        )
      )
        return;
      const current = includeSearch(uri, ctx);
      const proposed = includeSearch(moveUri(uri), projected);
      const updates = await Promise.all(
        doc.symbols.includes.map(async (literal) => {
          const path = await movedIncludePath(
            literal.text,
            current,
            proposed,
            afterMove,
            present,
            future,
          );
          return { literal, path };
        }),
      );
      if (!updates.some(({ path }) => path !== undefined)) return;
      const document = isProcessed(doc)
        ? doc.document
        : await readDocumentFromUri(uri);
      if (!document || ctx.store.get(uri) !== doc) return;
      const edits: TextEdit[] = [];
      for (const { literal, path } of updates) {
        if (path === undefined) continue;
        const range = literal.location.range;
        const original = document.getText(range);
        // Disk-backed ranges may have been indexed before an external edit.
        if (processPath(original) !== literal.text) continue;
        if (!isProcessed(doc)) {
          const { line } = range.start;
          const parsed = parseLine(
            document
              .getText(Range.create(line, 0, line + 1, 0))
              .replace(/\r?\n$/, ""),
          ).value;
          const statement = parsed.inlineStatement ?? parsed;
          const operand = statement.operands?.[0];
          if (
            statement.mnemonic?.type !== "directive" ||
            statement.mnemonic.directive.toLowerCase() !== "include" ||
            operand?.type !== "string-literal" ||
            operand.loc.start !== range.start.character ||
            operand.loc.end !== range.end.character
          )
            continue;
        }
        const replacement = spellInclude(path, original);
        if (replacement !== undefined && replacement !== original) {
          edits.push(TextEdit.replace(range, replacement));
        }
      }
      if (edits.length)
        return TextDocumentEdit.create(
          { uri, version: isProcessed(doc) ? document.version : null },
          edits,
        );
    }),
  );
  return changes.filter(
    (change): change is TextDocumentEdit => change !== undefined,
  );
}

function fileFinder(actualPath: (path: string) => string | undefined) {
  const known = new Map<string, Promise<boolean>>();
  return async (dir: string, name: string) => {
    const path = resolve(dir, name);
    const actual = actualPath(path);
    if (!actual) return;
    let exists = known.get(actual);
    if (!exists) {
      exists = stat(actual).then(
        (entry) => entry.isFile(),
        () => false,
      );
      known.set(actual, exists);
    }
    if (await exists) return path;
  };
}

type IncludeSearch = ReturnType<typeof includeSearch>;
type Finder = ReturnType<typeof fileFinder>;

async function movedIncludePath(
  name: string,
  current: IncludeSearch,
  proposed: IncludeSearch,
  afterMove: (path: string) => string,
  present: Finder,
  future: Finder,
) {
  const matches = await Promise.all(
    current.searches.map((search) =>
      resolveInclude(name, [search], [], present),
    ),
  );
  const found =
    matches.find(Boolean) ??
    (await resolveInclude(name, [], current.fallback, present));
  // The same include can name different files in different assembly units.
  if (!found || matches.some((match) => match && match.path !== found.path))
    return;
  const target = afterMove(found.path);
  const resolves = async (candidate: string) => {
    if (found.via === "fallback") {
      return (
        (
          await resolveInclude(
            candidate,
            proposed.searches,
            proposed.fallback,
            future,
          )
        )?.path === target
      );
    }
    const results = await Promise.all(
      proposed.searches.map((search) =>
        resolveInclude(candidate, [search], [], future),
      ),
    );
    return (
      results.some((result) => result?.path === target) &&
      results.every(
        (result, index) =>
          result?.path === target || (!matches[index] && !result),
      )
    );
  };
  if (await resolves(name)) return;
  if (isAbsolute(name)) return (await resolves(target)) ? target : undefined;

  const directories = proposed.searches.flatMap(vasmSearchDirectories);
  if (found.via === "fallback") directories.push(...proposed.fallback);
  const previousDir = afterMove(found.dir);
  if (directories.includes(previousDir)) directories.unshift(previousDir);
  for (const dir of new Set(directories)) {
    const candidate = relative(dir, target);
    if (candidate && !isAbsolute(candidate) && (await resolves(candidate)))
      return candidate;
  }
}

function spellInclude(path: string, original: string): string | undefined {
  const name = sep === "\\" ? path.replaceAll("\\", "/") : path;
  if (/[\r\n]/.test(name)) return;
  const quote = original[0];
  if (quote !== '"' && quote !== "'" && !/[\s;*,<>'"]/.test(name)) return name;
  const delimiter = [quote, '"', "'"].find(
    (character) =>
      (character === '"' || character === "'") && !name.includes(character),
  );
  return delimiter ? delimiter + name + delimiter : undefined;
}

import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { promises as fsp } from "fs";
import { resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname } from "path";
import { isAssemblySource, walkFiles } from "@m68k-lsp/workspace-files";

import { type Context } from "./context";
import { assemblerArgs, sourceRootOf, vasmRunDirectory } from "./config";
import {
  includeArguments,
  resolveInclude as resolveIncludeName,
  vasmSearchDirectories,
  type VasmSearch,
} from "@m68k-lsp/assembly-options";

const { readFile, access } = fsp;

export async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

export async function readDocumentFromUri(
  uri: string,
): Promise<TextDocument | null> {
  let content: string;

  try {
    content = await readFile(fileURLToPath(uri), "utf8");
  } catch (err) {
    return null;
  }

  return TextDocument.create(uri, "vasmmot", 0, content);
}

type ResolveContext = Pick<Context, "workspaceFolders" | "store" | "config">;

/**
 * Where an include named in a document is looked for.
 *
 * As vasm looks, for each program the document is part of: the directory it is
 * run in, the directory of the main source, the `-I` paths and the `incdir`s the
 * document can see. Which program is not always known, so each is tried. Then,
 * more forgivingly, beside the document itself and from each workspace folder,
 * which vasm would not do but finding a file it would not is harmless here.
 */
function includeSearch(documentUri: string, ctx: ResolveContext) {
  const workspaceRoots = workspacePaths(ctx);
  const entries = getEntryPointsFor(documentUri, ctx);
  const mains = (entries.length ? entries : [documentUri]).map(
    (uri) => URI.parse(uri).fsPath,
  );

  // Only incdirs the document can actually see: its own and those of the
  // files it includes. Pooling them across the whole store let an incdir in
  // one part of a workspace change how another part resolves its includes.
  const visible = [documentUri, ...getIncluded(documentUri, ctx)];
  const incDirs = visible
    .flatMap((uri) => ctx.store.get(uri)?.symbols.incDirs ?? [])
    .map((dir) => dir.text);

  const searches = mains.map((main) => vasmSearchFor(main, ctx, incDirs));
  const docDir = dirname(URI.parse(documentUri).fsPath);
  const sourceRoot = sourceRootOf(ctx.config, workspaceRoots);
  const fallback = [
    docDir,
    ...(sourceRoot ? [sourceRoot] : []),
    ...workspaceRoots,
  ].flatMap((root) => [root, ...incDirs.map((dir) => resolve(root, dir))]);
  return {
    searches,
    fallback: fallback.filter((dir, i) => fallback.indexOf(dir) === i),
  };
}

/** The paths of the workspace folders. */
export function workspacePaths(
  ctx: Pick<Context, "workspaceFolders">,
): string[] {
  return ctx.workspaceFolders.map((f) => URI.parse(f.uri).fsPath);
}

/**
 * Where vasm looks for an include when it assembles a main source: the directory
 * it is run in, the main source's, the `-I` paths from the config and the
 * `incdir`s given.
 */
export function vasmSearchFor(
  mainPath: string,
  ctx: ResolveContext,
  incDirs: readonly string[] = [],
): VasmSearch {
  return {
    cwd: vasmRunDirectory(ctx.config, workspacePaths(ctx), mainPath),
    mainDir: dirname(mainPath),
    includePaths: includeArguments(assemblerArgs(ctx.config)),
    incDirs,
  };
}

/** The file at a path under a directory, if there is one. */
async function findFile(
  dir: string,
  name: string,
): Promise<string | undefined> {
  const candidate = resolve(dir, name);
  return (await exists(candidate)) ? candidate : undefined;
}

/**
 * Resolve include file/dir path to first matching absolute file path.
 */
export async function resolveInclude(
  documentUri: string,
  path: string,
  ctx: ResolveContext,
): Promise<string | undefined> {
  const { searches, fallback } = includeSearch(documentUri, ctx);
  return (await resolveIncludeName(path, searches, fallback, findFile))?.path;
}

/**
 * Resolve include file/dir path to all possible file paths
 *
 * Returns full files paths which exist relative to incdirs and current document.
 */
export async function* resolveIncludesGen(
  documentUri: string,
  path: string | undefined,
  ctx: ResolveContext,
): AsyncGenerator<string> {
  const { searches, fallback } = includeSearch(documentUri, ctx);
  const seen = new Set<string>();
  const dirs = [...searches.flatMap(vasmSearchDirectories), ...fallback];
  for (const dir of dirs) {
    const candidate = path ? resolve(dir, path) : dir;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (await exists(candidate)) yield candidate;
  }
}

/**
 * Get array of URIs referenced in document
 */
export async function resolveReferencedUris(
  documentUri: string,
  ctx: ResolveContext,
): Promise<string[]> {
  const uris = new Set<string>();
  const docSymbols = ctx.store.get(documentUri)?.symbols;
  if (docSymbols) {
    await Promise.all(
      docSymbols.includes.map(async (path) => {
        const resolved = await resolveInclude(documentUri, path.text, ctx);
        if (resolved) {
          uris.add(URI.file(resolved).toString());
        }
      }),
    );
  }
  return Array.from(uris);
}

/**
 * Check whether file extension is ASM source file
 */
export function isAsmExt(filename: string): boolean {
  return isAssemblySource(filename);
}

/**
 * Get the containing directory of a file path
 *
 * For directories or non-existent return original path
 */
export async function getDirectory(path: string): Promise<string> {
  try {
    const stats = await fsp.stat(path);
    if (!stats.isDirectory()) {
      return dirname(path);
    }
  } catch (_) {
    return dirname(path);
  }
  return path;
}

/**
 * URIs a document includes, directly or through further includes.
 *
 * These are the files whose symbols are visible to it: including a file
 * brings its text, and so its definitions, into the including one.
 */
export function getIncluded(
  documentUri: string,
  ctx: ResolveContext,
): string[] {
  const result = new Set<string>();

  const visit = (uri: string) => {
    for (const next of ctx.store.get(uri)?.referencedUris ?? []) {
      if (!result.has(next)) {
        result.add(next);
        visit(next);
      }
    }
  };
  visit(documentUri);

  result.delete(documentUri);
  return Array.from(result);
}

/**
 * URIs that include a document, directly or through further includes.
 *
 * These are the files the document's own symbols are visible to, which is
 * where references to something it defines can appear.
 *
 * Kept separate from `getIncluded` on purpose. Following both directions at
 * once reaches every file sharing any include: two entry points that both
 * include a hardware definitions file would see each other's symbols, and a
 * rename in one would edit the other.
 */
export function getIncluders(
  documentUri: string,
  ctx: ResolveContext,
): string[] {
  const includers = new Map<string, string[]>();
  for (const [uri, processed] of ctx.store) {
    for (const included of processed.referencedUris) {
      const list = includers.get(included);
      if (list) {
        list.push(uri);
      } else {
        includers.set(included, [uri]);
      }
    }
  }

  const result = new Set<string>();
  const visit = (uri: string) => {
    for (const next of includers.get(uri) ?? []) {
      if (!result.has(next)) {
        result.add(next);
        visit(next);
      }
    }
  };
  visit(documentUri);

  result.delete(documentUri);
  return Array.from(result);
}

/**
 * URIs sharing an assembly unit with a document.
 *
 * An assembler splices includes into the file that pulls them in, so every
 * file in one of those trees shares a single namespace: a symbol defined in
 * any of them is visible in all of them, including in a file the definition's
 * own file includes.
 *
 * The trees a document belongs to are found from the files that include it,
 * and the rest of each tree from what those files include in turn. Only the
 * document itself is followed upwards. Following the upward edge from files
 * reached on the way down is what used to merge separate entry points that
 * happened to share a header, since it climbed out of one tree and back down
 * into another.
 */
export function getUnitFiles(
  documentUri: string,
  ctx: ResolveContext,
): string[] {
  const result = new Set<string>([documentUri]);

  for (const root of [documentUri, ...getIncluders(documentUri, ctx)]) {
    result.add(root);
    for (const included of getIncluded(root, ctx)) {
      result.add(included);
    }
  }

  result.delete(documentUri);
  return Array.from(result);
}

/**
 * Files sharing a unit with a document, ordered by how far away they are.
 *
 * Distance is steps through the include graph, so a file's own includes come
 * before its includers' other includes. Where a name is defined more than
 * once in a unit, the nearest definition is the one the reader most likely
 * means.
 */
export function getUnitFilesByDistance(
  documentUri: string,
  ctx: ResolveContext,
): string[] {
  const unit = new Set(getUnitFiles(documentUri, ctx));
  const ordered: string[] = [];
  const seen = new Set<string>([documentUri]);
  let frontier = [documentUri];

  while (frontier.length) {
    const next: string[] = [];
    for (const uri of frontier) {
      const neighbours = [
        ...(ctx.store.get(uri)?.referencedUris ?? []),
        ...directIncluders(uri, ctx),
      ];
      for (const neighbour of neighbours) {
        if (seen.has(neighbour) || !unit.has(neighbour)) {
          continue;
        }
        seen.add(neighbour);
        ordered.push(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  // Anything in the unit the walk did not reach, for completeness.
  for (const uri of unit) {
    if (!seen.has(uri)) {
      ordered.push(uri);
    }
  }
  return ordered;
}

function directIncluders(uri: string, ctx: ResolveContext): string[] {
  const result: string[] = [];
  for (const [candidate, doc] of ctx.store) {
    if (doc.referencedUris.includes(uri)) {
      result.push(candidate);
    }
  }
  return result;
}

/**
 * Files that are assembled directly rather than included by something else.
 *
 * A root of the include graph that pulls in at least one other file. The
 * second condition matters: a workspace holds plenty of files nothing
 * includes - vendored headers, unused data - and those are orphans rather
 * than programs.
 *
 * There is no formal marker for an entry point in assembly, so this is a
 * reading of the include graph, not a fact about the project.
 */
export function getEntryPoints(ctx: ResolveContext): string[] {
  const included = new Set<string>();
  for (const doc of ctx.store.values()) {
    for (const uri of doc.referencedUris) {
      included.add(uri);
    }
  }

  const entryPoints: string[] = [];
  for (const [uri, doc] of ctx.store) {
    if (!included.has(uri) && doc.referencedUris.length > 0) {
      entryPoints.push(uri);
    }
  }
  return entryPoints;
}

/**
 * Entry points whose include tree contains a document, nearest first.
 *
 * A file included by several programs belongs to each of them. The document
 * itself comes first when it is an entry point, so a program is its own
 * primary unit rather than being attributed to something that includes it.
 */
export function getEntryPointsFor(
  documentUri: string,
  ctx: ResolveContext,
): string[] {
  const entryPoints = new Set(getEntryPoints(ctx));
  const found: string[] = [];

  if (entryPoints.has(documentUri)) {
    found.push(documentUri);
  }
  for (const includer of getIncluders(documentUri, ctx)) {
    if (entryPoints.has(includer)) {
      found.push(includer);
    }
  }
  return found;
}

/**
 * Every assembly file under a directory, as URIs.
 *
 * The actual walk is shared with the linter's own language server; this is
 * just the URI boundary around it, since LSP works in URIs throughout while
 * the shared walker deals only in filesystem paths.
 */
export async function getAsmFilesInDir(
  uri: string,
  isExcluded?: (uri: string, isDirectory: boolean) => boolean,
): Promise<string[]> {
  const root = fileURLToPath(uri);
  const toUri = (path: string) => pathToFileURL(path).toString();

  const paths = await walkFiles(root, {
    prune: isExcluded
      ? (dir: string) => isExcluded(toUri(dir), true)
      : undefined,
    include: (path) =>
      isAsmExt(path) && !(isExcluded?.(toUri(path), false) ?? false),
  });

  return paths.map(toUri);
}

export async function isDir(uri: string): Promise<boolean> {
  return (await fsp.stat(new URL(uri))).isDirectory();
}

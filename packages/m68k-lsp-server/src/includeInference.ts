import {
  inferSearchDirectories,
  resolveInclude,
  type InferredDirectory,
} from "@m68k-lsp/assembly-options";
import { existsSync } from "fs";
import { resolve } from "path";
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Range,
} from "vscode-languageserver";
import { URI } from "vscode-uri";
import { type Context } from "./context";
import { vasmSearchFor, workspacePaths } from "./files";

type InferenceContext = Pick<Context, "workspaceFolders" | "store" | "config">;

/** An include vasm would not find from where it looks. */
export interface UnresolvedInclude {
  name: string;
  /** The file the include is in. */
  uri: string;
  range: Range;
}

/**
 * The includes in a program that vasm would not find.
 *
 * Follows the includes from the main source, resolving each as vasm does: from
 * the directory it is run in, the main source's, then the `-I` paths and
 * `incdir`s, and not beside the file that names it. That is stricter than the
 * lookup used for navigation, which also tries beside the file. Includes made
 * by macros or names worked out at assembly time are not seen.
 */
export async function unresolvedIncludes(
  assembleUri: string,
  ctx: InferenceContext,
): Promise<UnresolvedInclude[]> {
  const mainPath = URI.parse(assembleUri).fsPath;
  const incDirs: string[] = [];
  const unresolved: UnresolvedInclude[] = [];
  const find = (dir: string, name: string) => {
    const path = resolve(dir, name);
    return existsSync(path) ? path : undefined;
  };

  const queue = [assembleUri];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const doc = ctx.store.get(queue[i]);
    if (!doc || !("symbols" in doc)) continue;
    for (const dir of doc.symbols.incDirs) incDirs.push(dir.text);
    for (const include of doc.symbols.includes) {
      const found = await resolveInclude(
        include.text,
        [vasmSearchFor(mainPath, ctx, incDirs)],
        [],
        find,
      );
      if (!found) {
        unresolved.push({
          name: include.text,
          uri: queue[i],
          range: include.location.range,
        });
        continue;
      }
      const next = URI.file(found.path).toString();
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return unresolved;
}

/** Directories the project's files suggest for includes that could not be found. */
export function inferDirectories(
  names: readonly string[],
  ctx: InferenceContext,
): InferredDirectory[] {
  if (ctx.config.inferIncludePaths === false || !names.length) return [];
  const files = [...ctx.store.keys()]
    .filter((uri) => uri.startsWith("file:"))
    .map((uri) => URI.parse(uri).fsPath);
  return inferSearchDirectories(names, files, { roots: workspacePaths(ctx) });
}

/**
 * The note that an include is only found through a guessed directory, at the
 * include that needed it, or at the top of the file when it is not known where.
 */
export function inferenceDiagnostic(
  inferred: InferredDirectory,
  name: string,
  range: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  },
): Diagnostic {
  const hint =
    inferred.kind === "sourceRoot"
      ? `set "sourceRoot": "${inferred.dir}" in .m68krc.json`
      : `add "${inferred.dir}" to "includePaths" in .m68krc.json`;
  return {
    range,
    message: `"${name}" was not found, and is assumed to be in ${inferred.dir}, which is not in the include paths. To make that permanent, ${hint}.`,
    severity: DiagnosticSeverity.Information,
    source: "m68k",
    code: "inferred-include-path",
    data: { dir: inferred.dir, kind: inferred.kind, name },
  };
}

/**
 * Notes on the includes in a file that vasm would not find but the project has a
 * file for, saying where that is and how to make it permanent. Worked out from
 * the source and the file system alone, so it needs no run of vasm.
 */
export async function includeNotes(
  uri: string,
  assembleUri: string,
  ctx: InferenceContext,
): Promise<Diagnostic[]> {
  const all = await unresolvedIncludes(assembleUri, ctx);
  const mine = all.filter((include) => include.uri === uri);
  if (!mine.length) return [];
  const inferred = inferDirectories(
    all.map((include) => include.name),
    ctx,
  );
  return mine.flatMap((include) => {
    const dir = inferred.find((d) => d.names.includes(include.name));
    return dir ? [inferenceDiagnostic(dir, include.name, include.range)] : [];
  });
}

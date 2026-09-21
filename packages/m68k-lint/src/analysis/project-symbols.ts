import { parseFile, symbolKey } from "m68k-parser";
import type { ExpressionNode } from "m68k-parser";
import { evaluateConstant } from "./constants.js";
import { ProjectMacros } from "./project-macros.js";
import { isInMacroDefinition, scanBlocks } from "./blocks.js";
import {
  constantDefinition,
  sameExpression,
  type ExternalSymbols,
} from "./symbols.js";

/**
 * Constants gathered from every file in the project, for the very common case
 * where a file uses a name an include defines.
 *
 * Files are linted one at a time, so a symbol defined in a header is simply
 * unknown, and roughly three quarters of the rules depend on resolving
 * constants. Reconstructing the real include hierarchy would need the entry
 * point and the assembler's include paths, neither of which is in the source.
 * Indexing every file sidesteps that.
 *
 * The index is deliberately monotonic: it can turn "unknown" into "known" but
 * never "known" into "wrong". A name is answered only when the whole project
 * agrees on one value for it. Where two files disagree — a per-platform header,
 * a debug and a release configuration — the name stays unknown, exactly as it
 * was before the index existed. Guessing there would be worse than not knowing,
 * because a wrong constant makes rules fire with full confidence.
 *
 * Definitions inside macro bodies are skipped for the same reason they are
 * skipped per-file: they belong to an expansion, not to a file.
 *
 * Macro definitions follow the same rule as constants. A macro is answered
 * only when every definition of that name in the project has the same body, so
 * a header that is only included on one target, or two variants of a macro for
 * different configurations, leave the call opaque rather than expanded as
 * whichever came first.
 */
export interface ProjectSymbols extends ExternalSymbols {
  /** Names the project defines inconsistently, and so cannot answer for. */
  readonly conflicts: readonly string[];
  readonly size: number;
}

export interface ProjectSourceFile {
  /** Path used to tell the user where a value came from. */
  path: string;
  source: string;
}

interface Definition {
  expression: ExpressionNode;
  origin: string;
}

/** How many files are read between yields when building without blocking. */
const YIELD_EVERY = 25;

/** Runs a builder that yields now and then to the end. */
function finish<T>(build: Generator<void, T, void>): T {
  for (;;) {
    const step = build.next();
    if (step.done) return step.value;
  }
}

/**
 * Builds the symbols for a project. This is a loop over every file, which on a
 * project of thousands of them is seconds of work; `buildProjectSymbolsAsync`
 * does the same and lets other work run in between.
 */
export function buildProjectSymbols(
  files: readonly ProjectSourceFile[],
  options: { caseSensitive?: boolean } = {},
): ProjectSymbols {
  return finish(symbolsBuilder(files, options));
}

/**
 * Builds the same symbols as `buildProjectSymbols`, but calls `yieldNow` every
 * few files, so a server that is building an index does not stop answering
 * everything else for as long as the build takes.
 */
export async function buildProjectSymbolsAsync(
  files: readonly ProjectSourceFile[],
  options: { caseSensitive?: boolean } = {},
  yieldNow: () => Promise<void> = () =>
    new Promise((resolve) => setImmediate(resolve)),
): Promise<ProjectSymbols> {
  const build = symbolsBuilder(files, options);
  for (;;) {
    const step = build.next();
    if (step.done) return step.value;
    await yieldNow();
  }
}

function* symbolsBuilder(
  files: readonly ProjectSourceFile[],
  options: { caseSensitive?: boolean },
): Generator<void, ProjectSymbols, void> {
  const caseSensitive = options.caseSensitive ?? true;
  const keyOf = (name: string) => symbolKey(name, caseSensitive);
  const definitions = new Map<string, Definition>();
  const conflicted = new Set<string>();
  const macros = new ProjectMacros(caseSensitive);

  let read = 0;
  for (const { path, source } of files) {
    if (++read % YIELD_EVERY === 0) yield;
    let parsed;
    try {
      parsed = parseFile(source);
    } catch {
      // A file that will not parse contributes nothing. It is not this pass's
      // job to report that; linting the file itself will.
      continue;
    }
    const blocks = scanBlocks(parsed);

    macros.add(path, parsed, source);

    parsed.lines.forEach((line, lineIndex) => {
      const definition = constantDefinition(line);
      if (!definition) return;
      if (isInMacroDefinition(blocks, lineIndex)) return;

      const name = keyOf(definition.name);
      if (conflicted.has(name)) return;
      const existing = definitions.get(name);
      if (
        existing &&
        !sameExpression(existing.expression, definition.expression)
      ) {
        conflicted.add(name);
        definitions.delete(name);
        return;
      }
      if (!existing)
        definitions.set(name, {
          expression: definition.expression,
          origin: path,
        });
    });
  }

  const resolve = (name: string, stack: Set<string>): number | undefined => {
    const key = keyOf(name);
    if (stack.has(key)) return undefined;
    const definition = definitions.get(key);
    if (!definition) return undefined;
    const next = new Set(stack).add(key);
    const result = evaluateConstant(definition.expression, (referenced) =>
      resolve(referenced, next),
    );
    return result.known ? result.value : undefined;
  };

  return {
    conflicts: [...conflicted].sort(),
    size: definitions.size,
    lookup(name) {
      const value = resolve(name, new Set());
      if (value === undefined) return undefined;
      return { value, origin: definitions.get(keyOf(name))!.origin };
    },
    macro: (name) => macros.get(name),
  };
}

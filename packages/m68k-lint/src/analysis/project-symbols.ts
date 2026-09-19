import { collectMacroDefinitions, parseBlocks, parseFile } from "m68k-parser";
import type { ExpressionNode } from "m68k-parser";
import { evaluateConstant } from "./constants.js";
import { isInMacroDefinition, scanBlocks } from "./blocks.js";
import {
  constantDefinition,
  type ExternalMacro,
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

interface MacroEntry extends ExternalMacro {
  /** The body as written, for telling whether two definitions agree. */
  key: string;
}

function sameExpression(a: ExpressionNode, b: ExpressionNode): boolean {
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "loc")
        .map(([key, inner]) => [key, strip(inner)]),
    );
  }
  return value;
}

export function buildProjectSymbols(
  files: readonly ProjectSourceFile[],
): ProjectSymbols {
  const definitions = new Map<string, Definition>();
  const conflicted = new Set<string>();
  const macros = new Map<string, MacroEntry>();
  const conflictedMacros = new Set<string>();

  for (const { path, source } of files) {
    let parsed;
    try {
      parsed = parseFile(source);
    } catch {
      // A file that will not parse contributes nothing. It is not this pass's
      // job to report that; linting the file itself will.
      continue;
    }
    const blocks = scanBlocks(parsed);

    // A macro defined inside another macro's body belongs to its expansions.
    const found = collectMacroDefinitions(
      parsed,
      source.split(/\r?\n/),
      parseBlocks(parsed),
    );
    for (const macro of found) {
      if (
        found.some(
          (o) => o !== macro && o.start < macro.start && macro.end < o.end,
        )
      )
        continue;
      const key = macro.name.toLowerCase();
      if (conflictedMacros.has(key)) continue;
      const entry: MacroEntry = {
        definition: macro,
        origin: path,
        key: macro.body.map((line) => line.trimEnd()).join("\n"),
      };
      const existing = macros.get(key);
      if (existing && existing.key !== entry.key) {
        conflictedMacros.add(key);
        macros.delete(key);
      } else if (!existing) macros.set(key, entry);
    }

    parsed.lines.forEach((line, lineIndex) => {
      const definition = constantDefinition(line);
      if (!definition) return;
      if (isInMacroDefinition(blocks, lineIndex)) return;

      const name = definition.name.toLowerCase();
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
    const key = name.toLowerCase();
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
      return { value, origin: definitions.get(name.toLowerCase())!.origin };
    },
    macro(name) {
      const entry = macros.get(name.toLowerCase());
      return entry && { definition: entry.definition, origin: entry.origin };
    },
  };
}

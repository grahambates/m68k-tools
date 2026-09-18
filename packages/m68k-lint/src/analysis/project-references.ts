import { parseFile } from "m68k-parser";
import { collectReferencedSymbols } from "./references.js";
import type { ProjectSourceFile } from "./project-symbols.js";

/**
 * Every name the project names anywhere, gathered for rules that need to know
 * whether a symbol is used at all rather than what it resolves to.
 *
 * Unlike `ProjectSymbols`, which answers what a constant equals, this only
 * answers whether a name appears -- as a branch target, a data table entry, an
 * XDEF/XREF, or any other operand reference -- in any file the index was built
 * from. XDEF and XREF need no special handling: their operands parse as
 * ordinary symbol references, so a name a file exports or imports already
 * counts as referenced without this module knowing those directives exist.
 *
 * A file that will not parse contributes nothing, the same way it does for
 * `ProjectSymbols`: it is not this pass's job to report that.
 */
export interface ProjectReferences {
  references(name: string): boolean;
}

export function buildProjectReferences(
  files: readonly ProjectSourceFile[],
): ProjectReferences {
  const referenced = new Set<string>();
  for (const { source } of files) {
    let parsed;
    try {
      parsed = parseFile(source);
    } catch {
      continue;
    }
    collectReferencedSymbols(parsed.lines, referenced);
  }
  return {
    references: (name) => referenced.has(name.toLowerCase()),
  };
}

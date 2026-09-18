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
  /**
   * Whether a macro of this name is invoked anywhere in the project.
   *
   * Separate from `references`: a macro call is written where an instruction
   * would be, so it is a mnemonic rather than an operand symbol, and the
   * operand of the `MACRO` directive that defines it is a symbol that would
   * otherwise make every macro look used by its own definition.
   */
  invokes(name: string): boolean;
}

export function buildProjectReferences(
  files: readonly ProjectSourceFile[],
): ProjectReferences {
  const referenced = new Set<string>();
  const invoked = new Set<string>();
  for (const { source } of files) {
    let parsed;
    try {
      parsed = parseFile(source);
    } catch {
      continue;
    }
    collectReferencedSymbols(parsed.lines, referenced);
    for (const line of parsed.lines)
      if (line.mnemonic?.type === "macro")
        invoked.add(line.mnemonic.macro.toLowerCase());
  }
  return {
    references: (name) => referenced.has(name.toLowerCase()),
    invokes: (name) => invoked.has(name.toLowerCase()),
  };
}

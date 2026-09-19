import {
  expandMacro,
  macroInvocation,
  parseFile,
  type ParsedLine,
} from "m68k-parser";
import { scanBlocks } from "./blocks.js";
import { ProjectMacros } from "./project-macros.js";
import { collectReferencedSymbols, symbolNamesIn } from "./references.js";
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
 * A macro call can name something the call itself does not spell out:
 * `CALLINIT Sound` over `jsr Init_\1` refers to `Init_Sound`. So each call to a
 * macro the project defines is expanded and the names in the result counted
 * too. That can only add references, which is the safe direction for a rule that
 * reports a name as unused.
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
  const macros = new ProjectMacros();
  // Calls are expanded once every file has been read, since the macro may be
  // defined in one that comes later.
  const calls: { line: ParsedLine; text: string }[] = [];

  for (const { path, source } of files) {
    let parsed;
    try {
      parsed = parseFile(source);
    } catch {
      continue;
    }
    collectReferencedSymbols(parsed.lines, referenced);
    macros.add(path, parsed, source);

    const regions = scanBlocks(parsed).region;
    const text = source.split(/\r?\n/);
    parsed.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "macro") return;
      invoked.add(line.mnemonic.macro.toLowerCase());
      // A call in a macro body is expanded with the macro that contains it.
      if (regions[index] === 0) calls.push({ line, text: text[index] ?? "" });
    });
  }

  let unique = 0;
  for (const { line, text } of calls) {
    if (line.mnemonic?.type !== "macro") continue;
    const found = macros.get(line.mnemonic.macro);
    if (!found) continue;
    const expansion = expandMacro(
      found.definition,
      macroInvocation(line, text),
      {
        resolve: (name) => macros.get(name)?.definition,
        unique: () => String(unique++),
      },
    );
    for (const expanded of expansion.lines)
      for (const operand of expanded.line.operands ?? [])
        for (const name of symbolNamesIn(operand))
          referenced.add(name.toLowerCase());
  }

  return {
    references: (name) => referenced.has(name.toLowerCase()),
    invokes: (name) => invoked.has(name.toLowerCase()),
  };
}

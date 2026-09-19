import { collectMacroDefinitions, parseBlocks, symbolKey } from "m68k-parser";
import type { ParsedFile } from "m68k-parser";
import type { ExternalMacro } from "./symbols.js";

interface Entry extends ExternalMacro {
  /** The body as written, for telling whether two definitions agree. */
  key: string;
}

/**
 * Macro definitions gathered from every file of a project.
 *
 * A name is answered only when every definition of it in the project has the
 * same body, the rule the constants index follows: it can turn "unknown" into
 * "known", never "known" into "wrong". A macro defined two ways -- a header for
 * one target and another for a second -- is left unanswered rather than taken
 * from whichever file was read first. A definition inside another macro's body
 * belongs to that macro's expansions and is not the project's.
 */
export class ProjectMacros {
  private readonly entries = new Map<string, Entry>();
  private readonly conflicted = new Set<string>();

  /** @param caseSensitive whether `Push` and `push` are different macros */
  constructor(private readonly caseSensitive = true) {}

  /** Add every definition in a parsed file. */
  add(path: string, parsed: ParsedFile, source: string): void {
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
      const key = symbolKey(macro.name, this.caseSensitive);
      if (this.conflicted.has(key)) continue;
      const entry: Entry = {
        definition: macro,
        origin: path,
        key: macro.body.map((line) => line.trimEnd()).join("\n"),
      };
      const existing = this.entries.get(key);
      if (existing && existing.key !== entry.key) {
        this.conflicted.add(key);
        this.entries.delete(key);
      } else if (!existing) this.entries.set(key, entry);
    }
  }

  /** The macro of this name, if the project agrees on one definition of it. */
  get(name: string): ExternalMacro | undefined {
    const entry = this.entries.get(symbolKey(name, this.caseSensitive));
    return entry && { definition: entry.definition, origin: entry.origin };
  }

  /** Names the project defines in more than one way, and so cannot answer for. */
  get conflicts(): readonly string[] {
    return [...this.conflicted].sort();
  }
}

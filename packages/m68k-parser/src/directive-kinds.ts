import { blockAlternatives, blockOpeners, blockTerminators } from "./syntax.js";

/**
 * Every name a section can be given as its type: `section name,code_c`.
 *
 * The three base kinds, each with the memory attribute suffixes (`_c` chip,
 * `_f` fast, `_p` public), plus the older spellings some assemblers accept.
 * `sectionTypes` is only the three base kinds, which is what the parser needs
 * to tell a type from a name; this is what a person may write.
 */
export const sectionTypeNames = [
  "bss",
  "bss_c",
  "bss_f",
  "bss_p",
  "text",
  "text_c",
  "text_f",
  "text_p",
  "code",
  "code_c",
  "code_f",
  "code_p",
  "cseg",
  "data",
  "data_c",
  "data_f",
  "data_p",
  "dseg",
] as const;

const SECTION_DIRECTIVES = new Set([
  "section",
  "code",
  "data",
  "bss",
  "text",
  "cseg",
  "dseg",
]);

/** Whether a directive starts a section: `section`, or a bare `code`, `data`, `bss`... */
export function isSectionDirective(directive: string): boolean {
  return SECTION_DIRECTIVES.has(directive.toLowerCase());
}

/**
 * Whether a directive opens, continues or closes a block: a macro, a repeat, or
 * an arm of conditional assembly.
 */
export function isBlockDirective(directive: string): boolean {
  const name = directive.toLowerCase();
  return (
    name in blockOpeners ||
    blockAlternatives.has(name) ||
    blockTerminators.has(name)
  );
}

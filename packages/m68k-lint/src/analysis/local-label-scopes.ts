import {
  analyzeLocalLabelScopes as resolveScopes,
  isLocalLabelName,
  type LocalLabelScopes as ResolvedScopes,
  type ParsedFile,
} from "m68k-parser";
import { scanBlocks } from "./blocks.js";
import { symbolNamesIn } from "./references.js";

export interface LocalLabelScopes extends ResolvedScopes {
  /** Every local-label key referenced anywhere at file scope. */
  readonly referenced: ReadonlySet<string>;
}

/**
 * The parser's local-label scopes, with which local labels the file refers to.
 *
 * Which global label a local one belongs to is the parser's to say, so every
 * tool agrees on it. What is added here is the set of local labels that some
 * operand names, for the rules that ask whether one is used.
 */
export function analyzeLocalLabelScopes(file: ParsedFile): LocalLabelScopes {
  const scopes = resolveScopes(file);
  const blocks = scanBlocks(file);

  const referenced = new Set<string>();
  file.lines.forEach((line, index) => {
    // A macro body is not file-level source: its local labels and references
    // belong to each expansion, not to one place this scan can see.
    if (blocks.region[index] !== 0) return;
    for (const operand of line.operands ?? [])
      for (const name of symbolNamesIn(operand))
        if (isLocalLabelName(name)) referenced.add(scopes.keyOf(index, name));
  });

  return { ...scopes, referenced };
}

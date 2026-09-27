import type { ParsedFile, ParsedLine } from "m68k-parser";
import { getFlagSemantics } from "../semantics/flags.js";
import { expansionOf } from "../semantics/macro-expansions.js";
import { canonicalMnemonic } from "../semantics/mnemonics.js";
import { scanBlocks } from "./blocks.js";
import { conditionalAssembly } from "./conditionals.js";

/** Directives that put data in the current section. */
const DATA = new Set(["dc", "ds", "dcb", "blk", "db", "dw", "dl", "incbin"]);

/** Whether a line puts data, rather than code, at this point in its section. */
export function isData(line: ParsedLine): boolean {
  const mnemonic = line.mnemonic;
  return (
    mnemonic?.type === "directive" && DATA.has(mnemonic.directive.toLowerCase())
  );
}

/** Whether a line puts code or data at this point in its section. */
export function emits(line: ParsedLine): boolean {
  const type = line.mnemonic?.type;
  return type === "instruction" || type === "macro" || isData(line);
}

/**
 * Whether execution can continue past this line into whatever follows it.
 *
 * Undefined where that cannot be known: a macro that cannot be seen into, a
 * line made conditional by IIF, or a TRAP, which usually returns but is also
 * how a program exits on some systems (GEMDOS `Pterm0` is `trap #1`).
 */
export function fallsThrough(line: ParsedLine): boolean | undefined {
  if (line.inlineCondition !== undefined) return undefined;
  if (line.mnemonic?.type === "macro") {
    const expansion = expansionOf(line);
    const last = expansion?.[expansion.length - 1];
    return last ? fallsThrough(last) : undefined;
  }
  const mnemonic = canonicalMnemonic(line);
  if (mnemonic === "trap") return undefined;
  // ILLEGAL takes an exception and does not come back.
  if (mnemonic === "illegal") return false;
  const flow = getFlagSemantics(line).controlFlow;
  return (
    flow === "fallthrough" || flow === "conditional-branch" || flow === "call"
  );
}

export interface EmittedLines {
  /** Whether a line is assembled at file level, rather than skipped or in a macro body. */
  assembled(index: number): boolean;
  /** The next line after `index` that is assembled and emits code or data, if any. */
  nextAfter(index: number): number | undefined;
}

/** Which lines are assembled and emit something, for following the source forward. */
export function emittedLines(file: ParsedFile): EmittedLines {
  const blocks = scanBlocks(file);
  const assembly = conditionalAssembly(file);
  const assembled = (index: number) =>
    blocks.region[index] === 0 && !assembly.unassembled[index];
  return {
    assembled,
    nextAfter(index) {
      for (let next = index + 1; next < file.lines.length; next++)
        if (assembled(next) && emits(file.lines[next])) return next;
      return undefined;
    },
  };
}

/**
 * Whether a line, or the macro expansion it stands for, ends with a subroutine
 * call, after which execution comes back to whatever follows.
 */
export function endsWithCall(line: ParsedLine): boolean {
  const expansion =
    line.mnemonic?.type === "macro" ? expansionOf(line) : undefined;
  const last = expansion ? expansion[expansion.length - 1] : line;
  return last !== undefined && getFlagSemantics(last).controlFlow === "call";
}

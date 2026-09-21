import {
  blockRole,
  parseBlocks,
  type Block,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";

export { directiveName } from "m68k-parser";

/**
 * Assembler block structure: which lines belong to a macro definition, and
 * where REPT bodies begin and end.
 *
 * Both change what a line means. Instructions between MACRO and ENDM run
 * wherever the macro is invoked rather than where they are written, so they
 * neither join the flow of the surrounding code nor define file-global
 * constants. A REPT body is assembled more than once, so its last line is
 * followed by its first.
 *
 * The nesting itself comes from m68k-parser; this reshapes it into the flat
 * views the analyses want.
 */
export interface BlockStructure {
  /** Flow region per line. 0 is the file itself; each macro definition gets its own. */
  region: number[];
  /** REPT blocks, as the index of the REPT directive and its matching ENDR. */
  repeats: { start: number; end: number }[];
  /** Conditional assembly blocks, whose arms are alternatives rather than a sequence. */
  conditionals: ConditionalBlock[];
}

/**
 * An IF/ELSE/ENDC block. Exactly one arm is assembled, so the arms are
 * alternatives: the code above the block reaches each of them, and each of them
 * reaches the code below. Running one arm into the next, which is what treating
 * the directives as ordinary skipped lines does, makes a write in the first arm
 * look overwritten by the second.
 */
export interface ConditionalBlock {
  /** The opening IF directive. */
  start: number;
  /** ELSE and ELSEIF directives, in order; each opens a further arm. */
  alternatives: number[];
  /** The closing ENDC or ENDIF. */
  end: number;
}

/** Whether a line sits inside a macro definition rather than at file level. */
export function isInMacroDefinition(
  blocks: BlockStructure,
  index: number,
): boolean {
  return (blocks.region[index] ?? 0) !== 0;
}

/**
 * Directives that break a run of instructions into separate blocks.
 *
 * Two instructions either side of one are not a straight-line sequence: the
 * arms of a conditional are alternatives, a REPT body runs a different number
 * of times than the code around it, and a macro definition is not executed
 * where it is written. A rule matching across one is matching a sequence that
 * does not exist, and a replacement spanning one would delete it.
 */
export function isBlockBoundary(line: ParsedLine | undefined): boolean {
  // A line made conditional by `iif` is one: it runs or not, so what is beside it
  // is not a sequence with it.
  return blockRole(line) !== undefined || line?.inlineCondition !== undefined;
}

export function scanBlocks(file: ParsedFile): BlockStructure {
  const region = new Array<number>(file.lines.length).fill(0);
  const repeats: { start: number; end: number }[] = [];
  const conditionals: ConditionalBlock[] = [];
  let nextRegion = 0;

  /**
   * Only a macro definition at file level opens a new region: one nested in
   * another belongs to the same run of source, and an unterminated one runs to
   * the end of the file.
   */
  const visit = (blocks: Block[], current: number): void => {
    for (const block of blocks) {
      const inner =
        block.kind === "macro" && current === 0 ? ++nextRegion : current;
      if (inner !== 0) {
        const last = block.end ?? file.lines.length - 1;
        for (let i = block.start; i <= last; i++) region[i] = inner;
      }

      // Only blocks that actually close describe a span of source.
      if (block.end !== undefined) {
        if (block.kind === "repeat") {
          repeats.push({ start: block.start, end: block.end });
        } else if (block.kind === "conditional") {
          conditionals.push({
            start: block.start,
            alternatives: block.alternatives,
            end: block.end,
          });
        }
      }

      visit(block.children, inner);
    }
  };
  visit(parseBlocks(file).blocks, 0);

  return { region, repeats, conditionals };
}

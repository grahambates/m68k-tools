import { unexpectedBlockTerminator, unterminatedBlock } from "./parse-error.js";
import { blockAlternatives, blockOpeners, blockTerminators } from "./syntax.js";
import type { Block, BlockStructure, ParsedFile, ParsedLine } from "./types.js";

/** The directive a line uses, lowercased, if it uses one. */
export function directiveName(
  line: ParsedLine | undefined,
): string | undefined {
  return line?.mnemonic?.type === "directive"
    ? line.mnemonic.directive.toLowerCase()
    : undefined;
}

/**
 * How a directive relates to block structure, if at all.
 *
 * Useful for classifying a single line without deriving the whole structure:
 * a run of instructions that crosses one of these is not a straight-line
 * sequence, since the arms of a conditional are alternatives, a repeat body
 * runs a different number of times than the code around it, and a macro body
 * is not executed where it is written.
 */
export function blockRole(
  line: ParsedLine | undefined,
): "opener" | "alternative" | "terminator" | undefined {
  const directive = directiveName(line);
  if (!directive) {
    return undefined;
  }
  if (directive in blockOpeners) {
    return "opener";
  }
  if (blockAlternatives.has(directive)) {
    return "alternative";
  }
  if (blockTerminators.has(directive)) {
    return "terminator";
  }
  return undefined;
}

interface OpenBlock extends Block {
  /** Directives that close this block. */
  closers: readonly string[];
  /** The directive that opened it, for the unterminated message. */
  opener: string;
}

/**
 * Derive the block structure of a parsed file.
 *
 * Lines are parsed independently, so nesting has to be recovered afterwards.
 * This walks the directives once and pairs each opener with its terminator,
 * which is what callers otherwise reimplement: folding ranges, the extent of a
 * macro definition, and knowing that the arms of a conditional are
 * alternatives rather than a sequence.
 *
 * Indices are positions in `ParsedFile.lines`, counted from zero, not the
 * one-based `Location.line`.
 */
export function parseBlocks(file: ParsedFile): BlockStructure {
  const blocks: Block[] = [];
  const stack: OpenBlock[] = [];
  const errors = [];

  /** Where to add a block: inside the innermost open one, else at file level. */
  const target = () =>
    stack.length ? stack[stack.length - 1].children : blocks;

  const locOf = (index: number) => {
    const line = file.lines[index];
    const node = line?.mnemonic;
    return node
      ? { ...node.loc, line: index + 1 }
      : { start: 0, end: 0, line: index + 1 };
  };

  const close = (open: OpenBlock, end: number | undefined) => {
    // Discard the bookkeeping fields so the result is plain block data.
    const block = open as Block &
      Partial<Pick<OpenBlock, "closers" | "opener">>;
    if (end !== undefined) {
      block.end = end;
    } else {
      errors.push(
        unterminatedBlock(open.opener, open.closers, locOf(open.start)),
      );
    }
    delete block.closers;
    delete block.opener;
  };

  for (let index = 0; index < file.lines.length; index++) {
    const directive = directiveName(file.lines[index]);
    if (!directive) {
      continue;
    }

    if (blockTerminators.has(directive)) {
      // Find the innermost open block this can close. Anything nested inside
      // it was left unterminated, as in `macro / ifeq / endm`.
      let depth = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].closers.includes(directive)) {
          depth = i;
          break;
        }
      }
      if (depth === -1) {
        errors.push(unexpectedBlockTerminator(directive, locOf(index)));
        continue;
      }
      for (let i = stack.length - 1; i > depth; i--) {
        close(stack[i], undefined);
      }
      close(stack[depth], index);
      stack.length = depth;
      continue;
    }

    if (blockAlternatives.has(directive)) {
      const open = stack[stack.length - 1];
      if (open?.kind === "conditional") {
        open.alternatives.push(index);
      } else {
        errors.push(unexpectedBlockTerminator(directive, locOf(index)));
      }
      continue;
    }

    const closers = blockOpeners[directive];
    if (!closers) {
      continue;
    }

    const block: OpenBlock = {
      kind:
        directive === "macro"
          ? "macro"
          : directive === "rept"
            ? "repeat"
            : "conditional",
      start: index,
      alternatives: [],
      children: [],
      closers,
      opener: directive,
    };
    // A macro definition takes its name from the line's label.
    const label = file.lines[index].label;
    if (block.kind === "macro" && label) {
      block.name = label.label;
    }
    target().push(block);
    stack.push(block);
  }

  // Anything still open at the end of the file never closed.
  for (let i = stack.length - 1; i >= 0; i--) {
    close(stack[i], undefined);
  }

  return { blocks, errors };
}

/** Every block containing a line, outermost first. */
export function enclosingBlocks(
  structure: BlockStructure,
  index: number,
): Block[] {
  const found: Block[] = [];
  let level = structure.blocks;

  for (;;) {
    const block = level.find(
      (b) => b.start <= index && index <= (b.end ?? Infinity),
    );
    if (!block) {
      return found;
    }
    found.push(block);
    level = block.children;
  }
}

/** The innermost block containing a line, if any. */
export function blockAt(
  structure: BlockStructure,
  index: number,
): Block | undefined {
  const enclosing = enclosingBlocks(structure, index);
  return enclosing[enclosing.length - 1];
}

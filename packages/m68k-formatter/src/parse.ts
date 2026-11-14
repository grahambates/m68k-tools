import type { Location } from "m68k-parser";
import { parseLine as parseM68k } from "m68k-parser";

export interface ParsedLine {
  label?: Component;
  mnemonic?: Component;
  size?: Component;
  /**
   * Everything between the mnemonic and the comment, as one span. Not one
   * component per operand: an `iif` line's condition and statement are not
   * operands, but they sit in the same column and must be kept.
   */
  operands?: Component;
  comment?: Component;
}

export interface Component {
  start: number;
  end: number;
  value: string;
}

/**
 * Parse a single line of source code into positional components.
 *
 * A flat, position-oriented view of a line, kept deliberately simpler than the
 * full m68k-parser AST: consumers here only care where each element sits and
 * what text it covers.
 *
 * The aligner rebuilds a line from these components alone, so any text outside
 * them is lost. Every character of the line must belong to one of them.
 */
export function parseLine(text: string): ParsedLine {
  const { value: ast } = parseM68k(text);
  const line: ParsedLine = {};

  const component = ({ start, end }: Location): Component => ({
    start,
    end,
    value: text.slice(start, end),
  });

  if (ast.label) {
    line.label = component(ast.label.loc);
  }
  if (ast.mnemonic) {
    line.mnemonic = component(ast.mnemonic.loc);
  }
  if (ast.qualifier) {
    // An unrecognised or half-typed size ("move." / "move.z") comes back as an
    // unknown qualifier spanning the text after the dot, which is empty in the
    // first case. Completion needs that to know the cursor is on a size.
    line.size = component(ast.qualifier.loc);
  }
  // Taken from the text rather than from the parsed operands, which would miss
  // whatever the parser does not treat as an operand, and the aligner would
  // then drop it.
  const operandsFrom = ast.qualifier?.loc.end ?? ast.mnemonic?.loc.end;
  if (operandsFrom !== undefined) {
    const rest = text.slice(
      operandsFrom,
      ast.comment?.loc.start ?? text.length,
    );
    const start = operandsFrom + rest.length - rest.trimStart().length;
    const end = operandsFrom + rest.trimEnd().length;
    if (end > start) {
      line.operands = component({ start, end });
    }
  }
  if (ast.comment) {
    line.comment = component(ast.comment.loc);
  }

  return line;
}

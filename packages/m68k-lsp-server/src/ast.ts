import {
  childNodes,
  descendants,
  isAstNode,
  lineNodes,
  walkFile,
  walkLine,
  type AstNode,
  type Location,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import type * as lsp from "vscode-languageserver";

/** A matched node together with the chain that leads to it. */
export interface AstPath {
  /** Innermost node containing the position. */
  node: AstNode;
  /** Enclosing nodes, outermost first. Empty when `node` is a line component. */
  ancestors: AstNode[];
  /** The line `node` was found on. */
  line: ParsedLine;
}

/**
 * Does a node span the given column?
 *
 * The end is inclusive so that a cursor sitting immediately after a token
 * still resolves to it, which is what completion and signature help need
 * while a token is being typed.
 */
export function containsColumn(loc: Location, character: number): boolean {
  return loc.start <= character && character <= loc.end;
}

/**
 * Innermost node at a column on an already parsed line.
 *
 * Where the inclusive end makes two adjacent nodes both match, the earlier one
 * wins, so a cursor at a token's end belongs to that token rather than to
 * whatever follows it.
 */
export function nodeAtColumn(
  line: ParsedLine,
  character: number,
): AstPath | undefined {
  const ancestors: AstNode[] = [];
  let match: AstNode | undefined;
  let candidates = lineNodes(line);

  for (;;) {
    const next = candidates.find((node) => containsColumn(node.loc, character));
    if (!next) {
      break;
    }
    if (match) {
      ancestors.push(match);
    }
    match = next;
    candidates = childNodes(next);
  }

  return match ? { node: match, ancestors, line } : undefined;
}

/** The parsed line at a zero-based document line number. */
export function lineAt(file: ParsedFile, line: number): ParsedLine | undefined {
  return file.lines[line];
}

/** Innermost node at a document position. */
export function nodeAtPosition(
  file: ParsedFile,
  position: lsp.Position,
): AstPath | undefined {
  const line = lineAt(file, position.line);
  return line ? nodeAtColumn(line, position.character) : undefined;
}

/** Nearest enclosing node of a given type, innermost first. */
export function closestAncestor(
  path: AstPath,
  type: string,
): AstNode | undefined {
  for (let i = path.ancestors.length - 1; i >= 0; i--) {
    if (path.ancestors[i].type === type) {
      return path.ancestors[i];
    }
  }
  return undefined;
}

// The walking itself is shared with the formatter and lives in m68k-parser;
// this module is where the server gets it from, alongside its own lookups.
export { childNodes, descendants, isAstNode, lineNodes, walkFile, walkLine };
export type { AstNode };

import type { Location, ParsedFile, ParsedLine } from "m68k-parser";
import type * as lsp from "vscode-languageserver";

/**
 * Any node in an m68k-parser syntax tree.
 *
 * The parser exports a closed union of around forty node interfaces which
 * share no common base beyond `type` and `loc`, and that union grows with each
 * parser release. Traversal below is therefore structural rather than a switch
 * over the union: a node type added upstream is walked without a change here.
 */
export interface AstNode {
  type: string;
  loc: Location;
}

/** A matched node together with the chain that leads to it. */
export interface AstPath {
  /** Innermost node containing the position. */
  node: AstNode;
  /** Enclosing nodes, outermost first. Empty when `node` is a line component. */
  ancestors: AstNode[];
  /** The line `node` was found on. */
  line: ParsedLine;
}

export function isAstNode(value: unknown): value is AstNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { type, loc } = value as Partial<AstNode>;
  return (
    typeof type === "string" &&
    typeof loc === "object" &&
    loc !== null &&
    typeof loc.start === "number"
  );
}

/**
 * Collect nodes held directly by an object's own properties.
 *
 * Covers both single-node properties (`ImmediateNode.value`) and node arrays
 * (`ParsedLine.operands`). Non-node values such as `Location`, `lineNumber`
 * and `RegisterListNode.raw` fail the guard and are skipped.
 */
function collectNodes(source: object): AstNode[] {
  const nodes: AstNode[] = [];
  for (const value of Object.values(source)) {
    if (isAstNode(value)) {
      nodes.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) {
          nodes.push(item);
        }
      }
    }
  }
  return nodes.sort((a, b) => a.loc.start - b.loc.start);
}

/** Direct children of a node, in source order. */
export function childNodes(node: AstNode): AstNode[] {
  return collectNodes(node);
}

/**
 * Top level components of a line (label, mnemonic, qualifier, operands,
 * comment), in source order. A `ParsedLine` is a plain record rather than a
 * node, so it has no `loc` of its own.
 */
export function lineNodes(line: ParsedLine): AstNode[] {
  return collectNodes(line);
}

/** Every node on a line, parents before children. */
export function walkLine(line: ParsedLine): AstNode[] {
  const out: AstNode[] = [];
  const visit = (nodes: AstNode[]) => {
    for (const node of nodes) {
      out.push(node);
      visit(childNodes(node));
    }
  };
  visit(lineNodes(line));
  return out;
}

/** Every node in a file, paired with the line it belongs to. */
export function walkFile(
  file: ParsedFile,
): Array<{ node: AstNode; line: ParsedLine }> {
  const out: Array<{ node: AstNode; line: ParsedLine }> = [];
  for (const line of file.lines) {
    for (const node of walkLine(line)) {
      out.push({ node, line });
    }
  }
  return out;
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

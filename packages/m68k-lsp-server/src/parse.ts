import type { Location } from "m68k-parser";
import { parseLine as parseM68k } from "m68k-parser";

export interface ParsedLine {
  label?: Component;
  mnemonic?: Component;
  size?: Component;
  /** For an `iif`: the mnemonic and size of the statement it makes conditional. */
  inlineMnemonic?: Component;
  inlineSize?: Component;
  operands?: Component[];
  comment?: Component;
}

export interface Component {
  start: number;
  end: number;
  value: string;
}

export enum ComponentType {
  Label,
  Mnemonic,
  Size,
  Operand,
  Comment,
}

export interface ComponentInfo {
  type: ComponentType;
  component: Component;
  index?: number;
}

/**
 * Parse a single line of source code into positional components.
 *
 * A flat, position-oriented view of a line, kept deliberately simpler than the
 * full m68k-parser AST: consumers here only care where each element sits and
 * what text it covers. The parser is resilient, so half-typed lines still come
 * back usable, which is what completion and signature help rely on.
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
  const inner = ast.inlineStatement;
  if (inner?.mnemonic) line.inlineMnemonic = component(inner.mnemonic.loc);
  if (inner?.qualifier) line.inlineSize = component(inner.qualifier.loc);
  if (ast.operands?.length) {
    line.operands = ast.operands.map((operand) => component(operand.loc));
  }
  if (ast.comment) {
    line.comment = component(ast.comment.loc);
  }

  return line;
}

/**
 * Identify the component at given postion on a line
 */
export function componentAtIndex(
  {
    label,
    mnemonic,
    size,
    inlineMnemonic,
    inlineSize,
    operands,
    comment,
  }: ParsedLine,
  index: number,
): ComponentInfo | undefined {
  if (label && containsIndex(label, index)) {
    return {
      component: label,
      type: ComponentType.Label,
    };
  }
  if (mnemonic && containsIndex(mnemonic, index)) {
    return {
      component: mnemonic,
      type: ComponentType.Mnemonic,
    };
  }
  if (inlineMnemonic && containsIndex(inlineMnemonic, index)) {
    return {
      component: inlineMnemonic,
      type: ComponentType.Mnemonic,
    };
  }
  if (size && containsIndex(size, index)) {
    return {
      component: size,
      type: ComponentType.Size,
    };
  }
  if (inlineSize && containsIndex(inlineSize, index)) {
    return {
      component: inlineSize,
      type: ComponentType.Size,
    };
  }
  if (operands) {
    for (const i in operands) {
      const operand = operands[i];
      if (operand && containsIndex(operand, index)) {
        return {
          component: operand,
          type: ComponentType.Operand,
          index: Number(i),
        };
      }
    }
  }
  if (comment && containsIndex(comment, index)) {
    return {
      component: comment,
      type: ComponentType.Comment,
    };
  }

  return;
}

function containsIndex(component: Component, index: number): boolean {
  return component.start <= index && component.end >= index;
}

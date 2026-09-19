import { decodeStringEscapes } from "./string-escapes.js";
import type { BinaryOp, ExpressionNode, UnaryOp } from "./types.js";

export type ConstantResult =
  | { known: true; value: number }
  | {
      known: false;
      reason:
        | "unknown-symbol"
        | "builtin-symbol"
        | "current-address"
        | "macro-parameter"
        | "unknown-expression"
        | "division-by-zero"
        | "cyclic-symbol";
    };

export type ConstantResolver = (name: string) => number | undefined;

export interface EvaluateOptions {
  /** Whether a character constant's backslash escapes are read (`vasm -esc`). Default false. */
  escapeSequences?: boolean;
}

/**
 * Values are 32-bit signed, as vasm has them for this target: `$ffffffff` is
 * -1, so it is less than 5, and an overflowing product wraps. Checked against
 * vasm's own output. A fractional value is left as it is.
 */
const wrap = (value: number): number =>
  Number.isInteger(value) ? value | 0 : value;

const known = (value: number): ConstantResult => ({
  known: true,
  value: wrap(value),
});
const unknown = (
  reason: Exclude<ConstantResult, { known: true }>["reason"],
): ConstantResult => ({
  known: false,
  reason,
});

function evalUnary(operator: UnaryOp, value: number): number {
  switch (operator) {
    case "+":
      return value;
    case "-":
      return -value;
    case "~":
      return ~value;
    case "!":
      return value ? 0 : 1;
    default:
      return value;
  }
}

function evalBinary(
  operator: BinaryOp,
  left: number,
  right: number,
): ConstantResult {
  switch (operator) {
    case "+":
      return known(left + right);
    case "-":
      return known(left - right);
    case "*":
      return known(
        Number.isInteger(left) && Number.isInteger(right)
          ? Math.imul(left, right)
          : left * right,
      );
    case "/":
      return right === 0
        ? unknown("division-by-zero")
        : known(Math.trunc(left / right));
    case "%":
    case "//":
      return right === 0 ? unknown("division-by-zero") : known(left % right);
    case "&":
      return known(left & right);
    case "|":
    case "!":
      return known(left | right);
    case "^":
    case "~":
      return known(left ^ right);
    case "<<":
      return known(left << right);
    case ">>":
      return known(left >> right);
    case "&&":
      return known(left && right ? -1 : 0);
    case "||":
      return known(left || right ? -1 : 0);
    case "=":
    case "==":
      return known(left === right ? -1 : 0);
    case "<>":
    case "!=":
      return known(left !== right ? -1 : 0);
    case "<":
      return known(left < right ? -1 : 0);
    case ">":
      return known(left > right ? -1 : 0);
    case "<=":
      return known(left <= right ? -1 : 0);
    case ">=":
      return known(left >= right ? -1 : 0);
    // VASM supports extra expression operators whose exact semantics should be
    // copied from the assembler/parser before we evaluate them here.
    case ",":
    case ",,":
      return unknown("unknown-expression");
    default:
      return unknown("unknown-expression");
  }
}

export function evaluateConstant(
  expr: ExpressionNode,
  resolveSymbol: ConstantResolver = () => undefined,
  options: EvaluateOptions = {},
): ConstantResult {
  switch (expr.type) {
    case "numeric-literal":
      return known(expr.value);
    case "string-literal": {
      // A character constant: up to four characters, the first in the top byte
      // of those used, so 'AB' is $4142. `<text>` is a macro argument, not one.
      if (expr.quote === "<>") return unknown("unknown-expression");
      const { elements } = options.escapeSequences
        ? decodeStringEscapes(expr.content)
        : {
            elements: [...expr.content].map((char) => char.charCodeAt(0)),
          };
      if (elements.length > 4 || elements.some((e) => e > 255))
        return unknown("unknown-expression");
      return known(elements.reduce((value, e) => (value << 8) | e, 0));
    }
    case "symbol": {
      const value = resolveSymbol(expr.name);
      return value === undefined ? unknown("unknown-symbol") : known(value);
    }
    case "builtin-symbol":
      return unknown("builtin-symbol");
    case "current-address":
      return unknown("current-address");
    case "macro-parameter":
      return unknown("macro-parameter");
    case "group":
      return evaluateConstant(expr.expression, resolveSymbol, options);
    case "unary-op": {
      const operand = evaluateConstant(expr.operand, resolveSymbol, options);
      return operand.known
        ? known(evalUnary(expr.operator, operand.value))
        : operand;
    }
    case "binary-op": {
      const left = evaluateConstant(expr.left, resolveSymbol, options);
      if (!left.known) return left;
      const right = evaluateConstant(expr.right, resolveSymbol, options);
      if (!right.known) return right;
      return evalBinary(expr.operator, left.value, right.value);
    }
    case "unknown":
      return unknown("unknown-expression");
    default:
      return unknown("unknown-expression");
  }
}

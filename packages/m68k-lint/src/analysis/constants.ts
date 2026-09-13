import type { BinaryOp, ExpressionNode, UnaryOp } from "m68k-parser";

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

const known = (value: number): ConstantResult => ({ known: true, value });
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
      return known(left * right);
    case "/":
    case "//":
      return right === 0
        ? unknown("division-by-zero")
        : known(Math.trunc(left / right));
    case "%":
      return right === 0 ? unknown("division-by-zero") : known(left % right);
    case "&":
      return known(left & right);
    case "|":
      return known(left | right);
    case "^":
      return known(left ^ right);
    case "<<":
      return known(left << right);
    case ">>":
      return known(left >> right);
    case "&&":
      return known(left && right ? 1 : 0);
    case "||":
      return known(left || right ? 1 : 0);
    case "=":
    case "==":
      return known(left === right ? 1 : 0);
    case "<>":
    case "!=":
      return known(left !== right ? 1 : 0);
    case "<":
      return known(left < right ? 1 : 0);
    case ">":
      return known(left > right ? 1 : 0);
    case "<=":
      return known(left <= right ? 1 : 0);
    case ">=":
      return known(left >= right ? 1 : 0);
    // VASM supports extra expression operators whose exact semantics should be
    // copied from the assembler/parser before we evaluate them here.
    case ",":
    case ",,":
    case "~":
    case "!":
      return unknown("unknown-expression");
    default:
      return unknown("unknown-expression");
  }
}

export function evaluateConstant(
  expr: ExpressionNode,
  resolveSymbol: ConstantResolver = () => undefined,
): ConstantResult {
  switch (expr.type) {
    case "numeric-literal":
      return known(expr.value);
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
      return evaluateConstant(expr.expression, resolveSymbol);
    case "unary-op": {
      const operand = evaluateConstant(expr.operand, resolveSymbol);
      return operand.known
        ? known(evalUnary(expr.operator, operand.value))
        : operand;
    }
    case "binary-op": {
      const left = evaluateConstant(expr.left, resolveSymbol);
      if (!left.known) return left;
      const right = evaluateConstant(expr.right, resolveSymbol);
      if (!right.known) return right;
      return evalBinary(expr.operator, left.value, right.value);
    }
    case "unknown":
      return unknown("unknown-expression");
    default:
      return unknown("unknown-expression");
  }
}

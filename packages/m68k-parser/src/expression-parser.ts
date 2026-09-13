import {
  type BinaryOp,
  type ExpressionNode,
  type Location,
  type ParserResult,
} from "./types.js";
import {
  tokenizeExpression,
  type ExpressionToken,
} from "./expression-tokenizer.js";
import { isBuiltinSymbol, isUnaryOp } from "./syntax.js";
import { isInterpolated } from "./tokenizer-utils.js";
import {
  type ParseError,
  unclosedParen,
  invalidExpression,
} from "./parse-error.js";

/**
 * Parse an expression string into an expression AST
 * Uses recursive descent parser with vasm operator precedence
 * @param expr1 - The expression string to parse
 * @param loc - Location in the original source
 * @returns Parser result with expression node and optional error
 */
export function parseExpression(
  expr: string,
  loc: Location,
): ParserResult<ExpressionNode> {
  // Handle empty expressions
  if (!expr) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [],
    };
  }

  const { tokens, errors: tokenizerErrors } = tokenizeExpression(expr, loc);
  let pos = 0;
  let parseError: ParseError | undefined;

  function current(): ExpressionToken {
    return tokens[pos];
  }

  function advance(): void {
    pos++;
  }

  function tokenLocation(token: ExpressionToken): Location {
    let tokenLength: number;
    if (token.type === "eof") {
      tokenLength = 0;
    } else if (token.type === "string") {
      // Include the surrounding quotes
      tokenLength = token.value.length + 2;
    } else if (token.type === "macro-parameter") {
      // The tokenizer strips the leading backslash from the value
      tokenLength = token.value.length + 1;
    } else if ("value" in token) {
      tokenLength = token.value.length;
    } else {
      tokenLength = 1;
    }

    return {
      start: loc.start + token.position,
      end: loc.start + token.position + tokenLength,
      line: loc.line,
    };
  }

  function parsePrimary(): ExpressionNode {
    const token = current();
    const tokLoc = tokenLocation(token);

    if (token.type === "number") {
      advance();
      const value = Number(
        token.value
          .replace(/^\$/, "0x")
          .replace(/^%/, "0b")
          .replace(/^@/, "0o"),
      );
      return {
        type: "numeric-literal",
        format: token.format,
        raw: token.value,
        value,
        loc: tokLoc,
      };
    }

    if (token.type === "symbol") {
      const symbolName = token.value;
      advance();

      // Check if it's a built-in symbol
      if (isBuiltinSymbol(symbolName)) {
        return {
          type: "builtin-symbol",
          loc: tokLoc,
          name: symbolName,
        };
      }

      return {
        type: "symbol",
        ...(isInterpolated(token.value) ? { interpolated: true } : {}),
        loc: tokLoc,
        name: symbolName,
      };
    }

    if (token.type === "string") {
      advance();
      return {
        type: "string-literal",
        loc: tokLoc,
        quote: token.quote,
        content: token.value,
      };
    }

    if (token.type === "current-address") {
      advance();
      return {
        type: "current-address",
        loc: tokLoc,
      };
    }

    if (token.type === "macro-parameter") {
      const param = token.value;
      advance();

      let paramType: "numeric" | "special" | "named";
      if (/^\d+$/.test(param)) {
        paramType = "numeric";
      } else if (param === "@") {
        paramType = "special";
      } else {
        paramType = "named";
      }

      return {
        type: "macro-parameter",
        paramType,
        param,
        loc: tokLoc,
      };
    }

    if (token.type === "lparen") {
      advance();
      const expr = parseLogicalOr(); // Start from lowest precedence
      if (current()?.type === "rparen") {
        advance();
      } else {
        // Missing closing parenthesis
        if (!parseError) {
          parseError = unclosedParen(tokLoc);
        }
      }
      return {
        type: "group",
        loc: {
          ...tokLoc,
          end: loc.start + current().position,
        },
        expression: expr,
      };
    }

    // If we can't parse, return unknown and set error
    if (!parseError && token) {
      parseError = invalidExpression(
        `Unexpected token '${token.type}'`,
        tokLoc,
      );
    }
    return {
      type: "unknown",
      loc: tokLoc,
    };
  }

  function parseUnary(): ExpressionNode {
    const token = current();

    if (token.type === "operator" && isUnaryOp(token.value)) {
      const operator = token.value;
      advance();
      const operand = parseUnary();
      return {
        type: "unary-op",
        loc: {
          ...tokenLocation(token),
          end: operand.loc.end,
        },
        operator,
        operand,
      };
    }

    return parsePrimary();
  }

  /**
   * Helper to parse binary operators with given precedence
   * Eliminates duplication across parseShift, parseBitwiseAnd, etc.
   */
  function parseBinaryOp(
    parseHigher: () => ExpressionNode,
    operators: BinaryOp[],
    transformOp?: (op: string) => string,
  ): ExpressionNode {
    let left = parseHigher();

    let token = current();
    while (
      token.type === "operator" &&
      operators.includes(token.value as BinaryOp)
    ) {
      let operator = token.value;
      if (transformOp) {
        operator = transformOp(operator);
      }
      advance();
      const right = parseHigher();
      left = {
        type: "binary-op",
        loc: {
          start: left.loc.start,
          end: right.loc.end,
          line: left.loc.line,
        },
        operator: operator as BinaryOp, // Type will be validated by caller
        left,
        right,
      };
      token = current();
    }

    return left;
  }

  function parseShift(): ExpressionNode {
    return parseBinaryOp(parseUnary, ["<<", ">>"]);
  }

  function parseBitwiseAnd(): ExpressionNode {
    return parseBinaryOp(parseShift, ["&"]);
  }

  function parseBitwiseXor(): ExpressionNode {
    return parseBinaryOp(parseBitwiseAnd, ["^", "~"], (op) =>
      op === "~" ? "^" : op,
    );
  }

  function parseBitwiseOr(): ExpressionNode {
    return parseBinaryOp(parseBitwiseXor, ["|", "!"], (op) =>
      op === "!" ? "|" : op,
    );
  }

  function parseMultiplicative(): ExpressionNode {
    return parseBinaryOp(parseBitwiseOr, ["*", "/", "%", "//"], (op) =>
      op === "//" ? "%" : op,
    );
  }

  function parseAdditive(): ExpressionNode {
    return parseBinaryOp(parseMultiplicative, ["+", "-"]);
  }

  function parseComparison(): ExpressionNode {
    return parseBinaryOp(parseAdditive, ["<", ">", "<=", ">="]);
  }

  function parseEquality(): ExpressionNode {
    return parseBinaryOp(parseComparison, ["==", "=", "!=", "<>"], (op) =>
      op === "==" ? "=" : op === "!=" ? "<>" : op,
    );
  }

  function parseLogicalAnd(): ExpressionNode {
    return parseBinaryOp(parseEquality, ["&&"]);
  }

  function parseLogicalOr(): ExpressionNode {
    return parseBinaryOp(parseLogicalAnd, ["||"]);
  }

  const value = parseLogicalOr();

  // Collect all errors - prioritize tokenizer errors as they represent more fundamental issues
  // If tokenizer can't recognize characters, that's the root cause
  const errors: ParseError[] = [...tokenizerErrors];
  if (parseError) {
    errors.push(parseError);
  }

  return { value, errors };
}

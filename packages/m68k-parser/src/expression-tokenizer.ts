import { type Location, type NumberFormat } from "./types.js";
import {
  type ParseError,
  unknownCharacter,
  unterminatedString,
} from "./parse-error.js";
import {
  isDigit,
  isHexDigit,
  isBinaryDigit,
  isOctalDigit,
  isWhitespace,
} from "./tokenizer-utils.js";

// Expression tokenizer types
export type ExpressionToken =
  | {
      type: "number";
      value: string;
      format: NumberFormat;
      position: number;
    }
  | { type: "symbol"; value: string; position: number }
  | {
      type: "string";
      value: string;
      quote: '"' | "'";
      position: number;
    }
  | { type: "operator"; value: string; position: number }
  | { type: "macro-parameter"; value: string; position: number }
  | { type: "lparen"; position: number }
  | { type: "rparen"; position: number }
  | { type: "current-address"; position: number }
  | { type: "eof"; position: number };

export interface ExpressionTokenizeResult {
  tokens: ExpressionToken[];
  errors: ParseError[];
}

/**
 * Macro parameter forms recognised inside expressions.
 * Mirrors the set handled by parseMacroParameter() in macro-utils.
 */
const macroParameterPattern =
  /^\\(?:\d+|@[@!?]?|<[^>]*>|\?(?:\d+|[a-z])|[.+-]|[a-z])/i;

/**
 * Read a macro parameter sequence starting at the backslash at `start`.
 * Returns the raw text (including the backslash) or null if the backslash
 * doesn't introduce a recognised parameter.
 */
function readMacroParameter(expr: string, start: number): string | null {
  if (expr[start] !== "\\") return null;
  const match = macroParameterPattern.exec(expr.slice(start));
  return match ? match[0] : null;
}

/** Characters that can continue a symbol (excluding macro parameters) */
function isSymbolPart(ch: string): boolean {
  return /[\w.$@]/.test(ch);
}

/**
 * Tokenize an expression string
 * Returns tokens and any errors encountered during tokenization
 */
export function tokenizeExpression(
  expr: string,
  loc: Location,
): ExpressionTokenizeResult {
  const tokens: ExpressionToken[] = [];
  const errors: ParseError[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Skip whitespace
    if (isWhitespace(char)) {
      i++;
      continue;
    }

    // Numbers: $hex, %binary, @octal, or decimal
    // These prefixes are only number prefixes if they appear at start or after operator/paren
    const prevToken = tokens[tokens.length - 1];
    const canBeNumberPrefix =
      tokens.length === 0 ||
      prevToken?.type === "operator" ||
      prevToken?.type === "lparen";

    if (
      char === "$" &&
      canBeNumberPrefix &&
      i + 1 < expr.length &&
      isHexDigit(expr[i + 1])
    ) {
      // Hex number
      const position = i;
      let value = "$";
      i++;
      while (i < expr.length && isHexDigit(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "number", value, format: "hex", position });
      continue;
    }

    if (
      char === "%" &&
      canBeNumberPrefix &&
      i + 1 < expr.length &&
      isBinaryDigit(expr[i + 1])
    ) {
      // Binary number
      const position = i;
      let value = "%";
      i++;
      while (i < expr.length && isBinaryDigit(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "number", value, format: "binary", position });
      continue;
    }

    if (
      char === "@" &&
      canBeNumberPrefix &&
      i + 1 < expr.length &&
      isOctalDigit(expr[i + 1])
    ) {
      // Octal number
      const position = i;
      let value = "@";
      i++;
      while (i < expr.length && isOctalDigit(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "number", value, format: "octal", position });
      continue;
    }

    if (isDigit(char)) {
      // Decimal number, or a float where a dot separates two runs of digits.
      //
      // Digits are required on both sides: `1.w` is an address size suffix,
      // and a leading dot begins a local label. An exponent is only read as
      // part of a dotted float, so a bare `1e3` stays a number followed by a
      // symbol rather than being guessed at.
      const position = i;
      let value = "";
      while (i < expr.length && isDigit(expr[i])) {
        value += expr[i++];
      }

      if (expr[i] === "." && isDigit(expr[i + 1])) {
        value += expr[i++];
        while (i < expr.length && isDigit(expr[i])) {
          value += expr[i++];
        }

        const exponent = /^[eE][-+]?\d+/.exec(expr.slice(i));
        if (exponent) {
          value += exponent[0];
          i += exponent[0].length;
        }

        tokens.push({ type: "number", value, format: "float", position });
        continue;
      }

      tokens.push({ type: "number", value, format: "decimal", position });
      continue;
    }

    // Current address (*) - check if it's at the start or after an operator/paren
    if (char === "*") {
      const prevToken = tokens[tokens.length - 1];
      const isAtStart = tokens.length === 0;
      const afterOperator =
        prevToken &&
        (prevToken.type === "operator" || prevToken.type === "lparen");

      if (isAtStart || afterOperator) {
        tokens.push({ type: "current-address", position: i });
        i++;
        continue;
      }
    }

    // Parentheses
    if (char === "(") {
      tokens.push({ type: "lparen", position: i });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", position: i });
      i++;
      continue;
    }

    // Multi-character operators
    if (i + 1 < expr.length) {
      const twoChar = expr.slice(i, i + 2);
      if (
        ["<<", ">>", "==", "!=", "<>", "<=", ">=", "&&", "||", "//"].includes(
          twoChar,
        )
      ) {
        tokens.push({ type: "operator", value: twoChar, position: i });
        i += 2;
        continue;
      }
    }

    // Single-character operators
    if (
      [
        "+",
        "-",
        "!",
        "~",
        "&",
        "|",
        "^",
        "*",
        "/",
        "%",
        "<",
        ">",
        "=",
      ].includes(char)
    ) {
      tokens.push({ type: "operator", value: char, position: i });
      i++;
      continue;
    }

    // String/character literals: 'A', "AB"
    // In an expression these are numeric constants, e.g. ('D'<<24)!('O'<<16)
    if (char === "'" || char === '"') {
      const position = i;
      const quote = char as '"' | "'";
      i++; // opening quote
      let value = "";
      while (i < expr.length && expr[i] !== quote) {
        value += expr[i++];
      }
      if (i < expr.length) {
        i++; // closing quote
      } else {
        errors.push(
          unterminatedString(quote, {
            start: loc.start + position,
            end: loc.start + i,
            line: loc.line,
          }),
        );
      }
      tokens.push({ type: "string", value, quote, position });
      continue;
    }

    // Symbols and macro parameters.
    // A symbol can embed macro parameters (e.g. `BLTEN_\1`, `CMD\@`,
    // `PUSHM_\@@`), so identifier characters and backslash sequences are
    // scanned together. A backslash sequence on its own is a macro parameter.
    // `@` starts an identifier in vasm's mot syntax, as in `@palette`.
    if (char === "\\" || /[a-z_.@]/i.test(char)) {
      const position = i;
      let value = "";
      let firstParam: string | null = null;

      while (i < expr.length) {
        const ch = expr[i];
        if (ch === "\\") {
          const param = readMacroParameter(expr, i);
          if (!param) break;
          if (!value) firstParam = param;
          value += param;
          i += param.length;
        } else if (isSymbolPart(ch)) {
          value += expr[i++];
        } else {
          break;
        }
      }

      if (!value) {
        // Lone backslash that doesn't introduce a macro parameter
        i++;
        errors.push(
          unknownCharacter("\\", {
            start: loc.start + position,
            end: loc.start + position + 1,
            line: loc.line,
          }),
        );
        continue;
      }

      // vasm's ISBADID rejects a lone '.', '@' or '_' as an identifier.
      if (/^[.@_]$/.test(value)) {
        i++;
        errors.push(
          unknownCharacter(value, {
            start: loc.start + position,
            end: loc.start + position + 1,
            line: loc.line,
          }),
        );
        continue;
      }

      if (firstParam && firstParam === value) {
        // Standalone macro parameter - value excludes the leading backslash
        tokens.push({
          type: "macro-parameter",
          value: value.slice(1),
          position,
        });
      } else {
        tokens.push({ type: "symbol", value, position });
      }
      continue;
    }

    // Unknown character - report error and skip it
    errors.push(
      unknownCharacter(char, {
        start: loc.start + i,
        end: loc.start + i + 1,
        line: loc.line,
      }),
    );
    i++;
  }

  tokens.push({ type: "eof", position: i });
  return { tokens, errors };
}

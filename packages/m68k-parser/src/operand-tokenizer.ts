/**
 * Tokenizer for M68k operands
 * Converts operand strings into tokens for easier parsing of complex addressing modes
 */

import {
  isDataRegister,
  isAddressRegister,
  isSpecialRegister,
  isFPUDataRegister,
  isFPUControlRegister,
} from "./syntax.js";
import {
  type ParseError,
  unknownCharacter,
  malformedNumber,
} from "./parse-error.js";
import {
  isIdentifierStart,
  isIdentifierPart,
  isDigit,
  isHexDigit,
  isBinaryDigit,
  isOctalDigit,
  isWhitespace,
} from "./tokenizer-utils.js";

export type OperandTokenType =
  | "lparen" // (
  | "rparen" // )
  | "lbracket" // [
  | "rbracket" // ]
  | "lbrace" // {
  | "rbrace" // }
  | "comma" // ,
  | "dot" // .
  | "hash" // #
  | "plus" // +
  | "minus" // -
  | "star" // *
  | "slash" // /
  | "colon" // :
  | "tilde" // ~
  | "caret" // ^
  | "exclamation" // !
  | "pipe" // |
  | "ampersand" // &
  | "equals" // =
  | "less" // <
  | "greater" // >
  | "register" // d0-d7, a0-a7, sp, fp0-fp7, etc.
  | "number" // numeric literals
  | "symbol" // identifiers
  | "string" // quoted strings
  | "eof";

export interface OperandToken {
  type: OperandTokenType;
  value: string;
  position: number; // Character position in original string
}

export interface OperandTokenizeResult {
  tokens: OperandToken[];
  errors: ParseError[];
}

/**
 * Check if a string is a register name using existing helpers from syntax.ts
 */
function isRegisterName(str: string): boolean {
  const lower = str.toLowerCase();
  return (
    isDataRegister(lower) ||
    isAddressRegister(lower) ||
    isSpecialRegister(lower) ||
    isFPUDataRegister(lower) ||
    isFPUControlRegister(lower)
  );
}

/**
 * Tokenize an operand string
 * Returns tokens and any errors encountered during tokenization
 */
export function tokenizeOperand(text: string): OperandTokenizeResult {
  const tokens: OperandToken[] = [];
  const errors: ParseError[] = [];
  let pos = 0;

  function peek(offset = 0): string {
    return text[pos + offset] || "";
  }

  function advance(): string {
    return text[pos++] || "";
  }

  function skipWhitespace(): void {
    while (pos < text.length && isWhitespace(peek())) {
      pos++;
    }
  }

  while (pos < text.length) {
    skipWhitespace();
    if (pos >= text.length) break;

    const start = pos;
    const ch = peek();

    // Single character tokens
    switch (ch) {
      case "(":
        advance();
        tokens.push({ type: "lparen", value: "(", position: start });
        continue;
      case ")":
        advance();
        tokens.push({ type: "rparen", value: ")", position: start });
        continue;
      case "[":
        advance();
        tokens.push({ type: "lbracket", value: "[", position: start });
        continue;
      case "]":
        advance();
        tokens.push({ type: "rbracket", value: "]", position: start });
        continue;
      case "{":
        advance();
        tokens.push({ type: "lbrace", value: "{", position: start });
        continue;
      case "}":
        advance();
        tokens.push({ type: "rbrace", value: "}", position: start });
        continue;
      case ",":
        advance();
        tokens.push({ type: "comma", value: ",", position: start });
        continue;
      case ".":
        advance();
        tokens.push({ type: "dot", value: ".", position: start });
        continue;
      case "#":
        advance();
        tokens.push({ type: "hash", value: "#", position: start });
        continue;
      case "+":
        advance();
        tokens.push({ type: "plus", value: "+", position: start });
        continue;
      case "-":
        advance();
        tokens.push({ type: "minus", value: "-", position: start });
        continue;
      case "*":
        advance();
        tokens.push({ type: "star", value: "*", position: start });
        continue;
      case "/":
        advance();
        tokens.push({ type: "slash", value: "/", position: start });
        continue;
      case ":":
        advance();
        tokens.push({ type: "colon", value: ":", position: start });
        continue;
      case "~":
        advance();
        tokens.push({ type: "tilde", value: "~", position: start });
        continue;
      case "^":
        advance();
        tokens.push({ type: "caret", value: "^", position: start });
        continue;
      case "!":
        advance();
        tokens.push({ type: "exclamation", value: "!", position: start });
        continue;
      case "|":
        advance();
        tokens.push({ type: "pipe", value: "|", position: start });
        continue;
      case "&":
        advance();
        tokens.push({ type: "ampersand", value: "&", position: start });
        continue;
      case "=":
        advance();
        tokens.push({ type: "equals", value: "=", position: start });
        continue;
      case "<":
        // Check if this is a string literal <text> or an operator
        if (
          pos + 1 < text.length &&
          !isWhitespace(peek(1)) &&
          peek(1) !== ">"
        ) {
          // Could be either < operator or <string>
          // Peek ahead to see if there's a matching >
          let lookahead = pos + 1;
          while (
            lookahead < text.length &&
            text[lookahead] !== ">" &&
            !isWhitespace(text[lookahead])
          ) {
            lookahead++;
          }
          if (lookahead < text.length && text[lookahead] === ">") {
            // Looks like <string>, fall through to string literal handling below
            break;
          }
        }
        advance();
        tokens.push({ type: "less", value: "<", position: start });
        continue;
      case ">":
        advance();
        tokens.push({ type: "greater", value: ">", position: start });
        continue;
    }

    // String literals: "text", 'text', <text>
    if (ch === '"' || ch === "'") {
      const quote = advance();
      let value = "";
      while (pos < text.length && peek() !== quote) {
        value += advance();
      }
      if (peek() === quote) advance(); // consume closing quote
      tokens.push({
        type: "string",
        value: quote + value + quote,
        position: start,
      });
      continue;
    }

    if (ch === "<") {
      advance();
      let value = "";
      while (pos < text.length && peek() !== ">") {
        value += advance();
      }
      if (peek() === ">") advance(); // consume closing >
      tokens.push({
        type: "string",
        value: "<" + value + ">",
        position: start,
      });
      continue;
    }

    // Numbers: $hex, %binary, @octal, decimal
    if (ch === "$") {
      advance();
      let value = "$";
      while (pos < text.length && isHexDigit(peek())) {
        value += advance();
      }
      if (value === "$") {
        // No hex digits after $
        errors.push(malformedNumber("$", { start, end: start + 1 }));
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    if (ch === "%") {
      advance();
      let value = "%";
      while (pos < text.length && isBinaryDigit(peek())) {
        value += advance();
      }
      if (value === "%") {
        // No binary digits after %
        errors.push(malformedNumber("%", { start, end: start + 1 }));
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    if (ch === "@" && isDigit(peek(1))) {
      advance();
      let value = "@";
      while (pos < text.length && isOctalDigit(peek())) {
        value += advance();
      }
      if (value === "@") {
        // No octal digits after @
        errors.push(malformedNumber("@", { start, end: start + 1 }));
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    // Decimal numbers
    if (isDigit(ch)) {
      let value = "";
      while (pos < text.length && isDigit(peek())) {
        value += advance();
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    // Identifiers/Registers/Symbols
    if (isIdentifierStart(ch) || ch === "\\") {
      let value = "";

      // Consume a macro parameter starting at the current backslash:
      // \1, \@, \<name>, \@@, \@!, \@?, etc.
      const consumeMacroParameter = (): void => {
        value += advance(); // consume backslash
        if (peek() === "<") {
          value += advance(); // <
          while (pos < text.length && peek() !== ">") {
            value += advance();
          }
          if (peek() === ">") value += advance(); // >
          return;
        }
        // \1, \@, etc. - just take next char(s)
        while (
          pos < text.length &&
          (isIdentifierPart(peek()) ||
            peek() === "@" ||
            peek() === "?" ||
            peek() === "!")
        ) {
          value += advance();
          // Special handling for \@@, \@!, \@?
          if (
            value.endsWith("@") &&
            (peek() === "@" || peek() === "!" || peek() === "?")
          ) {
            value += advance();
            break;
          }
        }
      };

      // A symbol may mix plain identifier characters with embedded macro
      // parameters, e.g. `.jtab\@`, `b\1`, `foo\<x>`. Handle backslash
      // sequences explicitly so the macro parameter's trailing `@`/`?`/`!`
      // characters are consumed rather than left stranded. `isIdentifierPart`
      // matches `\`, so check for it first.
      while (pos < text.length) {
        const c = peek();
        if (c === "\\") {
          consumeMacroParameter();
        } else if (isIdentifierPart(c)) {
          value += advance();
        } else {
          break;
        }
      }

      // Determine if it's a register or symbol
      const tokenType = isRegisterName(value) ? "register" : "symbol";
      tokens.push({ type: tokenType, value, position: start });
      continue;
    }

    // Unknown character - report error and skip it
    errors.push(unknownCharacter(ch, { start: pos, end: pos + 1 }));
    advance();
  }

  tokens.push({ type: "eof", value: "", position: pos });
  return { tokens, errors };
}

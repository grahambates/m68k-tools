import { isLocalLabelName } from "./labels.js";
import { isInterpolated } from "./tokenizer-utils.js";
import {
  type ParsedLine,
  type LabelNode,
  type MnemonicNode,
  type QualifierNode,
  type OperandNode,
  type CommentNode,
  type InstructionNode,
  type DirectiveNode,
  type Size,
  type Instruction,
  type Directive,
  type ParserResult,
  type MacroNode,
} from "./types.js";
import { type ParseError } from "./parse-error.js";
import { parseOperand } from "./operand-parser.js";
import { parseExpression } from "./expression-parser.js";
import { isDirective, isInstruction, isSize, noOperand } from "./syntax.js";
import { parseMacroParameter } from "./macro-utils.js";

/**
 * Parser state - tracks position and accumulated errors
 */
interface ParserState {
  text: string;
  pos: number;
  line?: number;
  errors: ParseError[];
}

/**
 * Helper to check if at end of input
 */
function isEOF(state: ParserState): boolean {
  return state.pos >= state.text.length;
}

/**
 * Helper to peek at current character without consuming
 */
function peek(state: ParserState, offset: number = 0): string {
  return state.text[state.pos + offset] || "";
}

/**
 * Helper to peek ahead multiple characters
 */
function peekString(state: ParserState, length: number): string {
  return state.text.substring(state.pos, state.pos + length);
}

/**
 * Helper to consume current character and advance
 */
function advance(state: ParserState): string {
  const ch = peek(state);
  state.pos++;
  return ch;
}

/**
 * Skip whitespace (spaces and tabs only, not newlines)
 */
function skipWhitespace(state: ParserState): void {
  while (!isEOF(state) && /[ \t]/.test(peek(state))) {
    advance(state);
  }
}

/**
 * Check if current position could be a label
 * Labels can start with:
 * - Letter, underscore, dot, or backslash (for macro params)
 * - Must be at start of line OR have leading whitespace with a colon
 */
function isLabelStart(
  state: ParserState,
  hasLeadingWhitespace: boolean,
): boolean {
  const ch = peek(state);
  if (!ch || ch === ";" || ch === "*") return false;

  // If we have leading whitespace, we need a colon somewhere to be a label
  if (hasLeadingWhitespace) {
    // Look ahead for a colon (don't stop at whitespace, only at mnemonic-like structures)
    // Must track depth to avoid false positives from colons in bitfields {offset:width}
    let i = 0;
    let depth = 0;
    let quote: string | null = null;
    while (state.pos + i < state.text.length) {
      const ahead = peek(state, i);

      // A colon inside a string is text, not a label terminator: without this
      // `  LOG_INFO "DOS: loaded"` reads as a label followed by a comment, and
      // the whole macro invocation disappears from the parsed line.
      if (quote) {
        if (ahead === quote) quote = null;
        i++;
        continue;
      }
      if (ahead === '"' || ahead === "'") {
        quote = ahead;
        i++;
        continue;
      }

      // Track brace/bracket depth
      if (ahead === "{" || ahead === "[" || ahead === "(") {
        depth++;
      } else if (ahead === "}" || ahead === "]" || ahead === ")") {
        depth--;
      }

      // Only check for colon at depth 0
      if (ahead === ":" && depth === 0) return true;
      if (ahead === ";" || ahead === "*" || ahead === "=") return false;
      // Stop if we hit a potential size qualifier (.w, .l, etc.)
      if (
        ahead === "." &&
        depth === 0 &&
        /[wlbsqpx]/i.test(peek(state, i + 1))
      ) {
        return false;
      }
      i++;
    }
    return false;
  }

  // At start of line, anything that's not whitespace/comment can be a label
  return true;
}

/**
 * Parse a label
 * Format: identifier[:][:] or .identifier[:] or identifier$[:]
 * Scope: :: = external, . prefix or $ suffix = local, otherwise global
 */
function parseLabel(
  state: ParserState,
  hasLeadingWhitespace: boolean,
): LabelNode | null {
  if (!isLabelStart(state, hasLeadingWhitespace)) {
    return null;
  }

  // Skip leading whitespace if present
  if (hasLeadingWhitespace) {
    skipWhitespace(state);
  }

  const start = state.pos;
  let label = "";

  // Consume label characters (alphanumeric, underscore, dot, backslash, dollar)
  // Stop at: whitespace, colon, semicolon, star, equals, or dot followed by letter (size qualifier)
  while (!isEOF(state)) {
    const ch = peek(state);

    // Stop conditions
    if (ch === " " || ch === "\t" || ch === ";" || ch === "*" || ch === "=") {
      break;
    }

    // Colon marks end of label
    if (ch === ":") {
      break;
    }

    // Check for size qualifier: .w, .l, etc (but .label is a label)
    if (ch === "." && label.length > 0) {
      const next = peek(state, 1);
      if (
        next &&
        /[wlbsqpx]/i.test(next) &&
        !/[a-z0-9_$]/i.test(peek(state, 2) || "")
      ) {
        // This looks like a size qualifier, not part of the label
        break;
      }
    }

    // Valid label character
    if (/[a-z0-9_.$\\<>@!?+-]|/i.test(ch)) {
      label += ch;
      advance(state);
    } else {
      break;
    }
  }

  if (!label) {
    return null;
  }

  // Check for trailing colons
  let hasDoubleColon = false;
  let colonCount = 0;

  while (peek(state) === ":") {
    colonCount++;
    advance(state);
  }

  hasDoubleColon = colonCount >= 2;

  // Determine scope
  let scope: "global" | "local" | "external";
  if (hasDoubleColon) {
    scope = "external";
  } else if (isLocalLabelName(label)) {
    scope = "local";
  } else {
    scope = "global";
  }

  const end = start + label.length;

  return {
    type: "label",
    ...(isInterpolated(label) ? { interpolated: true } : {}),
    loc: { start, end, line: state.line },
    label,
    scope,
  };
}

/**
 * Check if a character is a strong indicator that we're still in an operand
 */
function isStrongOperandIndicator(ch: string): boolean {
  return /[#$%@()[\]<>]/.test(ch);
}

/**
 * Check if character could be an operator in an expression
 */
function isOperatorChar(ch: string): boolean {
  return /[+\-*/&|^~!=]/.test(ch);
}

/**
 * Check if the operand text looks complete (ends with closing bracket or alphanumeric)
 */
function operandLooksComplete(operandText: string): boolean {
  const lastChar = operandText.trim().slice(-1);
  return (
    lastChar === ")" ||
    lastChar === "]" ||
    lastChar === "}" ||
    /[a-z0-9]/i.test(lastChar)
  );
}

/**
 * Determine if we should continue parsing the operand after hitting whitespace
 * Returns true if the next content looks like it's part of the operand
 */
function shouldContinueOperand(
  state: ParserState,
  operandText: string,
): boolean {
  const nextCh = peek(state);
  const next2 = peekString(state, 2);

  // Strong operand indicators (punctuation)
  if (isStrongOperandIndicator(nextCh)) {
    return true;
  }

  // Operators after existing content - likely part of expression
  if (isOperatorChar(nextCh) && operandText.length > 0) {
    return true;
  }

  // Register pattern (letter followed by digit: d0, a7, fp0)
  if (/[a-z][0-9]/i.test(next2)) {
    return true;
  }

  // Macro parameter
  if (nextCh === "\\") {
    return true;
  }

  // Digit or underscore after existing content - part of expression, unless
  // the operand already reads as complete. Motorola syntax ends the operand
  // list at whitespace and treats the rest of the line as a comment, so the
  // trailing `0` in `dc.w bplcon1,$08 0` is a comment rather than more
  // expression. Same rule as for a plain letter below.
  if (/[0-9_]/.test(nextCh) && operandText.length > 0) {
    return !operandLooksComplete(operandText);
  }

  // Plain letter after complete structure - likely a comment
  if (/[a-z]/i.test(nextCh) && operandText.length > 0) {
    // If operand looks complete, this is a comment
    if (operandLooksComplete(operandText)) {
      return false;
    }
    // Otherwise include it
    return true;
  }

  // Doesn't look like operand content
  return false;
}

/**
 * Parse a mnemonic (instruction, directive, or macro)
 * Format: identifier or \macro-param
 */
function parseMnemonic(state: ParserState): MnemonicNode | null {
  const start = state.pos;

  // Check for special = directive
  if (peek(state) === "=") {
    advance(state);
    return {
      type: "directive",
      loc: { start, end: state.pos, line: state.line },
      directive: "=",
    };
  }

  // Check for macro parameter as mnemonic
  if (peek(state) === "\\") {
    const macroStart = state.pos;
    let macroText = "";

    // Consume macro parameter
    macroText += advance(state); // consume \

    // Extended forms: \@!, \@?, \@@
    if (peek(state) === "@") {
      macroText += advance(state); // consume @
      if (peek(state) === "!" || peek(state) === "?" || peek(state) === "@") {
        macroText += advance(state);
      }
    }
    // Query form: \?n or \?a
    else if (peek(state) === "?") {
      macroText += advance(state); // consume ?
      if (/[a-z0-9]/i.test(peek(state))) {
        macroText += advance(state);
      }
    }
    // Named form: \<name>
    else if (peek(state) === "<") {
      macroText += advance(state); // consume <
      while (!isEOF(state) && peek(state) !== ">") {
        macroText += advance(state);
      }
      if (peek(state) === ">") {
        macroText += advance(state);
      }
    }
    // CARG forms: \., \+, \-
    else if (
      peek(state) === "." ||
      peek(state) === "+" ||
      peek(state) === "-"
    ) {
      macroText += advance(state);
    }
    // Single char forms: \1-\9, \a-\z
    else if (/[a-z0-9]/i.test(peek(state))) {
      macroText += advance(state);
    }

    const macroEnd = state.pos;
    const macroParam = parseMacroParameter(macroText, {
      start: macroStart,
      end: macroEnd,
      line: state.line,
    });
    if (macroParam) {
      return macroParam;
    }
  }

  // Regular mnemonic (can contain macro parameters like "b\1")
  let mnemonic = "";
  while (!isEOF(state)) {
    const ch = peek(state);

    // Stop at whitespace, dot (size qualifier), semicolon, star
    if (ch === " " || ch === "\t" || ch === "." || ch === ";" || ch === "*") {
      break;
    }

    // Handle macro parameter embedded in mnemonic (e.g., "b\1")
    if (ch === "\\") {
      // Include the backslash and following macro parameter
      mnemonic += advance(state);

      // Extended forms: \@!, \@?, \@@
      if (peek(state) === "@") {
        mnemonic += advance(state);
        if (peek(state) === "!" || peek(state) === "?" || peek(state) === "@") {
          mnemonic += advance(state);
        }
      }
      // Named form: \<name>
      else if (peek(state) === "<") {
        mnemonic += advance(state);
        while (!isEOF(state) && peek(state) !== ">") {
          mnemonic += advance(state);
        }
        if (peek(state) === ">") {
          mnemonic += advance(state);
        }
      }
      // Query form: \?n
      else if (peek(state) === "?") {
        mnemonic += advance(state);
        if (/[a-z0-9]/i.test(peek(state))) {
          mnemonic += advance(state);
        }
      }
      // Single char forms: \1-\9, \a-\z, \., \+, \-
      else if (/[a-z0-9.+-]/i.test(peek(state))) {
        mnemonic += advance(state);
      }
      continue;
    }

    if (/[a-z0-9_]/i.test(ch)) {
      mnemonic += ch;
      advance(state);
    } else {
      break;
    }
  }

  if (!mnemonic) {
    return null;
  }

  const end = state.pos;
  const lcMnemonic = mnemonic.toLowerCase();

  // Determine mnemonic type
  if (isInstruction(lcMnemonic)) {
    return {
      type: "instruction",
      loc: { start, end, line: state.line },
      instruction: lcMnemonic,
    };
  } else if (isDirective(lcMnemonic)) {
    return {
      type: "directive",
      loc: { start, end, line: state.line },
      directive: lcMnemonic,
    };
  }
  return {
    type: "macro",
    loc: { start, end, line: state.line },
    macro: mnemonic,
  };
}

/**
 * Parse a size qualifier
 * Format: .size or .\macro-param
 */
function parseQualifier(state: ParserState): QualifierNode | null {
  if (peek(state) !== ".") {
    return null;
  }

  const start = state.pos;
  advance(state); // consume .

  // Check for macro parameter
  if (peek(state) === "\\") {
    const macroStart = state.pos;
    let macroText = "\\";
    advance(state);

    // Similar logic to mnemonic macro params
    if (peek(state) === "@") {
      macroText += advance(state);
      if (peek(state) === "!" || peek(state) === "?" || peek(state) === "@") {
        macroText += advance(state);
      }
    } else if (peek(state) === "<") {
      macroText += advance(state);
      while (!isEOF(state) && peek(state) !== ">") {
        macroText += advance(state);
      }
      if (peek(state) === ">") {
        macroText += advance(state);
      }
    } else if (/[a-z0-9]/i.test(peek(state))) {
      macroText += advance(state);
    }

    const macroEnd = state.pos;
    const macroParam = parseMacroParameter(macroText, {
      start: macroStart,
      end: macroEnd,
      line: state.line,
    });
    if (macroParam) {
      return macroParam;
    }
  }

  // Regular size
  let size = "";
  while (!isEOF(state) && /[a-z0-9]/i.test(peek(state))) {
    size += advance(state);
  }

  if (!size) {
    // A dot with nothing after it yet. Reported as an empty unknown qualifier
    // rather than dropped, so a caller can tell the cursor is on a size while
    // one is being typed.
    return {
      type: "unknown",
      loc: { start: start + 1, end: start + 1, line: state.line },
    };
  }

  const end = state.pos;
  const lcSize = size.toLowerCase();

  if (isSize(lcSize)) {
    return {
      type: "size",
      loc: { start: start + 1, end, line: state.line }, // start after the dot
      size: lcSize as Size,
    };
  }

  // Not a size the parser knows. The text was consumed either way, so it is
  // reported as an unknown qualifier rather than being dropped from the tree.
  return {
    type: "unknown",
    loc: { start: start + 1, end, line: state.line },
  };
}

/**
 * Check whether the text following a `macro` directive is a parameter name
 * list (`arg1,arg2`) rather than free-form documentation of the arguments.
 */
function isMacroParameterList(rest: string): boolean {
  const text = rest.replace(/[;*].*$/, "").trim();
  if (!text) return false;
  // A name, optionally angle-bracket quoted: arg1, <arg1>
  const name = "(?:[a-z_.][\\w.$]*|<[^<>]*>)";
  return new RegExp(`^${name}(?:\\s*,\\s*${name})*$`, "i").test(text);
}

/**
 * Parse operand list
 * Format: operand[,operand...]
 * Stops at: comment marker (;, *), or when encountering text that can't be part of an operand
 */
function parseOperandList(
  state: ParserState,
  context: {
    mnemonic: string;
    mnemonicType: "instruction" | "directive" | "macro" | "macro-parameter";
  },
): { operands: OperandNode[]; errors: ParseError[] } {
  const operands: OperandNode[] = [];
  const errors: ParseError[] = [];

  while (true) {
    skipWhitespace(state);

    // Check for comment marker
    // Semicolon always starts a comment
    // Asterisk only starts a comment if preceeded by space or is at EOL (not part of expression like *+10)
    if (peek(state) === ";") {
      break;
    }
    if (peek(state) === "*" && operands.length > 0) {
      const prev = peek(state, -1);
      // If * is preceeded by space/tab/EOL, it's a comment
      // If followed by operator or alphanumeric, it's part of expression (current address or mult)
      if (!prev || prev === " " || prev === "\t") {
        break;
      }
    }

    // Collect one operand (until comma, comment, or EOL)
    // Note: We allow EOF here to handle trailing commas
    const opStart = state.pos;
    let operandText = "";
    let depth = 0;
    let inString = false;
    let stringChar: string | null = null;
    let lastCharWasWhitespace = false; // Track if previous char was whitespace

    while (!isEOF(state)) {
      const ch = peek(state);

      // Handle strings
      if ((ch === '"' || ch === "'") && !inString) {
        inString = true;
        stringChar = ch;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
        continue;
      } else if (inString && ch === stringChar) {
        inString = false;
        stringChar = null;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
        continue;
      }

      if (inString) {
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
        continue;
      }

      // Handle angle bracket strings <text> specially
      // These are string literals, not operators, so handle them like quoted
      // strings. Only where the operand has not started yet: `<a,b>` is a whole
      // argument, whereas a `<` further in is a comparison or shift operator.
      // Without that restriction the lookahead below runs past a comma into a
      // later operand, so `dc.w (24<<6),0,(W>>4)` swallowed `<6),0,(W>` as a
      // string.
      if (ch === "<" && !inString && operandText.trim() === "") {
        // Peek ahead to see if this looks like a string literal
        let lookahead = state.pos + 1;
        while (lookahead < state.text.length && state.text[lookahead] !== ">") {
          lookahead++;
        }
        if (lookahead < state.text.length && state.text[lookahead] === ">") {
          // This is a string literal <text>, consume it all
          while (peek(state) !== ">" && !isEOF(state)) {
            operandText += advance(state);
          }
          if (peek(state) === ">") {
            operandText += advance(state);
          }
          lastCharWasWhitespace = false;
          continue;
        }
        // Otherwise, it's just a < operator, fall through to regular handling
      }

      // Track depth (parentheses, brackets, braces only - NOT angle brackets)
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
      } else if (depth === 0 && ch === ",") {
        // End of this operand (comma separator)
        break;
      } else if (depth === 0 && ch === ";") {
        // Semicolon always starts a comment
        break;
      } else if (depth === 0 && ch === "*" && lastCharWasWhitespace) {
        // Asterisk after whitespace starts a comment
        break;
      } else if (depth === 0 && (ch === " " || ch === "\t")) {
        lastCharWasWhitespace = true;
        // Whitespace at depth 0 - could be end of operand or separator within
        const saved = state.pos;
        advance(state); // consume whitespace
        skipWhitespace(state);

        // Check for definite end-of-operand markers.
        //
        // `/*` is included because Motorola syntax ends the operand field at
        // whitespace and treats the rest as a comment, which is how the C
        // style comments in the NDK headers work. Requiring the asterisk keeps
        // a spaced-out division such as `12 / 4` parsing as an expression.
        if (
          isEOF(state) ||
          peek(state) === "," ||
          peek(state) === ";" ||
          peek(state) === "*" ||
          peekString(state, 2) === "/*"
        ) {
          state.pos = saved;
          break;
        }

        // Use helper to determine if we should continue
        if (shouldContinueOperand(state, operandText)) {
          state.pos = saved;
          operandText += advance(state);
        } else {
          state.pos = saved;
          break;
        }
      } else {
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
      }
    }

    operandText = operandText.trim();

    // If we have no text and we're at EOF or no comma follows, we're done
    if (!operandText && isEOF(state)) {
      // Don't create empty operand if we haven't seen any commas yet
      if (operands.length > 0) {
        // This is after a comma - create empty unknown operand
        operands.push({
          type: "unknown",
          loc: { start: opStart, end: opStart, line: state.line },
        });
      }
      break;
    }

    // Parse the operand
    const opEnd = opStart + operandText.length;
    if (operandText) {
      const { value: operand, errors: operandErrors } = parseOperand(
        operandText,
        {
          start: opStart,
          end: opEnd,
          line: state.line,
        },
        {
          ...context,
          operandIndex: operands.length,
        },
      );
      // A macro argument is substituted textually, so it need not be a valid
      // operand. Where the expression stopped short of the argument's end, as
      // for `24BITDMA`, the structured parse is wrong rather than partial, so
      // the raw text is kept instead. Arguments that do parse in full keep
      // their structure, which is the common case.
      if (
        context?.mnemonicType === "macro" &&
        operand.type === "value" &&
        operand.value.loc.end < opEnd
      ) {
        operands.push({
          type: "macro-argument",
          loc: { start: opStart, end: opEnd, line: state.line },
          text: operandText,
        });
      } else {
        operands.push(operand);
        // Collect all errors from the result
        if (operandErrors && operandErrors.length > 0) {
          errors.push(...operandErrors);
        }
      }
    } else {
      // Empty operand (e.g., after comma but before next operand)
      operands.push({
        type: "unknown",
        loc: { start: opStart, end: opStart, line: state.line },
      });
    }

    // Check for comma (another operand follows)
    skipWhitespace(state);
    if (peek(state) === ",") {
      advance(state); // consume comma
      continue;
    }

    // No comma, we're done with operands
    break;
  }

  return { operands, errors };
}

/**
 * Parse a comment
 * Format: [;|*]text or just text (positional comment)
 */
function parseComment(state: ParserState): CommentNode | null {
  if (isEOF(state)) {
    return null;
  }

  const start = state.pos;
  skipWhitespace(state);

  const hasPrefix = peek(state) === ";" || peek(state) === "*";
  if (hasPrefix) {
    advance(state); // consume ; or *
  }

  // Skip whitespace after prefix
  while (!isEOF(state) && (peek(state) === " " || peek(state) === "\t")) {
    advance(state);
  }

  const contentStart = state.pos;

  // Consume rest of line
  while (!isEOF(state)) {
    advance(state);
  }

  const end = state.pos;
  const content = state.text.substring(contentStart, end).trim();

  if (!hasPrefix && !content) {
    return null;
  }

  return {
    type: "comment",
    loc: { start, end, line: state.line },
    hasPrefix,
    content,
  };
}

/**
 * Main entry point: parse a line of assembly
 * @param text - The line text to parse
 */
export function parseLine(
  text: string,
  lineNumber?: number,
): ParserResult<ParsedLine> {
  const state: ParserState = {
    text,
    pos: 0,
    line: lineNumber,
    errors: [],
  };

  const parsedLine: ParsedLine = {
    lineNumber,
  };

  // Track whether we have leading whitespace (affects label parsing)
  const hasLeadingWhitespace = /^[ \t]/.test(text);

  // Parse label (if at start of line or has colon)
  const label = parseLabel(state, hasLeadingWhitespace);
  if (label) parsedLine.label = label;

  // Skip whitespace
  skipWhitespace(state);

  // Parse mnemonic
  const mnemonic = parseMnemonic(state);
  if (mnemonic) parsedLine.mnemonic = mnemonic;

  // Parse size qualifier
  if (parsedLine.mnemonic) {
    const qualifier = parseQualifier(state);
    if (qualifier) {
      parsedLine.qualifier = qualifier;
    }
  }

  // Skip whitespace before operands
  skipWhitespace(state);

  // Special handling for iif directive
  if (
    parsedLine.mnemonic?.type === "directive" &&
    (parsedLine.mnemonic as DirectiveNode).directive === "iif"
  ) {
    // Parse iif: <condition> <statement>
    // Collect everything until comment or EOL
    const condStart = state.pos;
    let fullText = "";

    while (!isEOF(state) && peek(state) !== ";" && peek(state) !== "*") {
      fullText += advance(state);
    }

    // Split into condition and statement. As in vasm the condition is the
    // first blank-delimited word, so `iif x = 1 nop` does not read as `x = 1`.
    const match = /^(\S+)(\s+)(.*)$/.exec(fullText);
    if (match) {
      const [, conditionText, gap, statementText] = match;

      // Parse condition as expression
      const condEnd = condStart + conditionText.length;
      const { value: condExpr, errors: condErrors } = parseExpression(
        conditionText,
        {
          start: condStart,
          end: condEnd,
          line: lineNumber,
        },
      );
      parsedLine.inlineCondition = condExpr;
      if (condErrors && condErrors.length > 0) {
        state.errors.push(...condErrors);
      }

      // Parse the statement as a line of its own. The text before it is
      // blanked rather than cut off, so what is parsed keeps its place in the
      // line and every location in it is a location in this one.
      const statementStart = condEnd + gap.length;
      const statementResult = parseLine(
        " ".repeat(statementStart) + statementText,
        lineNumber,
      );
      state.errors.push(...statementResult.errors);
      parsedLine.inlineStatement = statementResult.value;
      if (statementResult.value.operands)
        parsedLine.operands = statementResult.value.operands;
    }
  } else if (parsedLine.mnemonic) {
    // Check if this is a no-operand mnemonic
    const mnemonicText =
      parsedLine.mnemonic.type === "instruction"
        ? (parsedLine.mnemonic as InstructionNode).instruction
        : parsedLine.mnemonic.type === "directive"
          ? (parsedLine.mnemonic as DirectiveNode).directive
          : (parsedLine.mnemonic as MacroNode).macro;

    const isNoOperand =
      mnemonicText &&
      noOperand.includes(mnemonicText as Instruction | Directive);

    // A `macro` definition line optionally names its parameters, but
    // assemblers ignore anything else that follows. Real-world sources
    // document the arguments there instead, e.g.
    // `ALERT MACRO (alertNumber, [paramArray])`, so only parse the remainder
    // as operands when it's a plain list of parameter names.
    const isMacroDefWithoutParamList =
      parsedLine.mnemonic.type === "directive" &&
      mnemonicText === "macro" &&
      !isMacroParameterList(state.text.slice(state.pos));

    if (!isNoOperand && !isMacroDefWithoutParamList) {
      // Regular operand parsing
      const { operands, errors } = parseOperandList(state, {
        mnemonic: mnemonicText,
        mnemonicType: parsedLine.mnemonic.type,
      });
      if (operands.length > 0) {
        parsedLine.operands = operands;
      }
      if (errors.length > 0) {
        state.errors.push(...errors);
      }
    }
    // If it's a no-operand instruction, skip operand parsing
    // Remaining text will be treated as a positional comment by parseComment()
  }

  // Parse comment
  const comment = parseComment(state);
  if (comment) parsedLine.comment = comment;

  return {
    value: parsedLine,
    errors: state.errors,
  };
}

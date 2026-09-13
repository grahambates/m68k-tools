import { type Location } from "./types.js";

export type ParseErrorCode =
  | "UNEXPECTED_TOKEN"
  | "EXPECTED_TOKEN"
  | "INVALID_REGISTER"
  | "INVALID_NUMBER"
  | "INVALID_SCALE_FACTOR"
  | "INVALID_INDEX_SIZE"
  | "UNCLOSED_BRACKET"
  | "UNCLOSED_PAREN"
  | "UNCLOSED_BRACE"
  | "UNTERMINATED_STRING"
  | "UNEXPECTED_EOF"
  | "MALFORMED_MEMORY_INDIRECT"
  | "MALFORMED_INDEXED_ADDRESSING"
  | "MALFORMED_BITFIELD"
  | "MALFORMED_REGISTER_LIST"
  | "INVALID_ADDRESSING_MODE"
  | "MISSING_DISPLACEMENT"
  | "MISSING_INDEX_REGISTER"
  | "DUPLICATE_COMPONENT"
  | "MISSING_OPERAND"
  | "INVALID_EXPRESSION"
  | "UNKNOWN_CHARACTER"
  | "MALFORMED_NUMBER"
  | "MISSING_SCALE_FACTOR"
  | "INVALID_BASE_REGISTER"
  | "INVALID_IDENTIFIER"
  | "UNTERMINATED_BLOCK"
  | "UNEXPECTED_BLOCK_TERMINATOR";

export interface ParseError {
  code: ParseErrorCode;
  message: string;
  loc: Location;
  expected?: string[]; // What was expected (for better error messages)
  got?: string; // What was actually found
  hint?: string; // Helpful suggestion for fixing the error
}

/**
 * Create a parse error object
 */
export function createError(
  code: ParseErrorCode,
  message: string,
  loc: Location,
  options?: {
    expected?: string[];
    got?: string;
    hint?: string;
  },
): ParseError {
  return {
    code,
    message,
    loc,
    expected: options?.expected,
    got: options?.got,
    hint: options?.hint,
  };
}

/**
 * Format an error for display with location context
 */
export function formatError(error: ParseError, operandText: string): string {
  const lines: string[] = [];

  lines.push(`Error: ${error.message}`);

  const length = error.loc.end - error.loc.start;

  // Show the operand text with a pointer to the error position
  lines.push(`  ${operandText}`);
  const pointer = " ".repeat(error.loc.start + 2) + "^";
  if (length > 1) {
    lines.push(pointer + "~".repeat(length - 1));
  } else {
    lines.push(pointer);
  }

  // Show expected vs got
  if (error.expected && error.expected.length > 0) {
    lines.push(`  Expected: ${error.expected.join(", ")}`);
  }
  if (error.got) {
    lines.push(`  Got: ${error.got}`);
  }

  // Show hint if available
  if (error.hint) {
    lines.push(`  Hint: ${error.hint}`);
  }

  return lines.join("\n");
}

/**
 * Common error creators for specific scenarios
 */

export function unexpectedToken(
  got: string,
  loc: Location,
  expected?: string[],
): ParseError {
  return createError("UNEXPECTED_TOKEN", `Unexpected token '${got}'`, loc, {
    expected,
    got,
    // length: got.length,
  });
}

export function expectedToken(
  expected: string[],
  loc: Location,
  got?: string,
): ParseError {
  return createError(
    "EXPECTED_TOKEN",
    `Expected ${expected.join(" or ")}`,
    loc,
    {
      expected,
      got,
    },
  );
}

export function unclosedBracket(loc: Location): ParseError {
  return createError(
    "UNCLOSED_BRACKET",
    "Unclosed bracket - missing ']'",
    loc,
    {
      hint: "Memory indirect addressing requires matching [ and ]",
    },
  );
}

export function unclosedParen(loc: Location): ParseError {
  return createError(
    "UNCLOSED_PAREN",
    "Unclosed parenthesis - missing ')'",
    loc,
    {
      hint: "Indirect addressing requires matching ( and )",
    },
  );
}

export function unclosedBrace(loc: Location): ParseError {
  return createError("UNCLOSED_BRACE", "Unclosed brace - missing '}'", loc, {
    hint: "Bitfield specification requires matching { and }",
  });
}

export function invalidScaleFactor(got: string, loc: Location): ParseError {
  return createError(
    "INVALID_SCALE_FACTOR",
    `Invalid scale factor '${got}'`,
    loc,
    {
      expected: ["1", "2", "4", "8"],
      got,
      hint: "Scale factor must be 1, 2, 4, or 8 (68020+ only)",
    },
  );
}

export function malformedIndexedAddressing(
  message: string,
  loc: Location,
): ParseError {
  return createError("MALFORMED_INDEXED_ADDRESSING", message, loc, {
    hint: "Indexed addressing format: disp(An,Rn.size) or (An,Rn.size)",
  });
}

export function malformedMemoryIndirect(
  message: string,
  loc: Location,
): ParseError {
  return createError("MALFORMED_MEMORY_INDIRECT", message, loc, {
    hint: "Memory indirect format: ([bd,An,Xn],od) or ([bd,An],Xn,od)",
  });
}

export function malformedBitfield(message: string, loc: Location): ParseError {
  return createError("MALFORMED_BITFIELD", message, loc, {
    hint: "Bitfield format: {offset:width} or {offset} or {Dn:Dm}",
  });
}

export function unterminatedString(quote: string, loc: Location): ParseError {
  return createError(
    "UNTERMINATED_STRING",
    `Unterminated string - missing closing ${quote}`,
    loc,
    { hint: `Add a closing ${quote} to end the string` },
  );
}

export function invalidExpression(message: string, loc: Location): ParseError {
  return createError("INVALID_EXPRESSION", message, loc);
}

export function unknownCharacter(char: string, loc: Location): ParseError {
  const displayChar =
    char === " "
      ? "space"
      : char === "\t"
        ? "tab"
        : char === "\n"
          ? "newline"
          : `'${char}'`;
  return createError(
    "UNKNOWN_CHARACTER",
    `Unknown character ${displayChar}`,
    loc,
    {
      got: char,
      // length: 1,
      hint: "Character is not valid in this context",
    },
  );
}

export function malformedNumber(prefix: string, loc: Location): ParseError {
  let hint: string;
  switch (prefix) {
    case "$":
      hint = "Hex number format: $1A2F (hexadecimal digits 0-9, A-F)";
      break;
    case "%":
      hint = "Binary number format: %1010 (binary digits 0-1)";
      break;
    case "@":
      hint = "Octal number format: @377 (octal digits 0-7)";
      break;
    default:
      hint = "Number must have digits after prefix";
  }

  return createError(
    "MALFORMED_NUMBER",
    `Malformed number with prefix '${prefix}'`,
    loc,
    {
      got: prefix,
      // length: 1,
      hint,
    },
  );
}

export function missingScaleFactor(loc: Location): ParseError {
  return createError(
    "MISSING_SCALE_FACTOR",
    "Missing scale factor after '*'",
    loc,
    {
      expected: ["1", "2", "4", "8", "expression"],
      hint: "Scale factor required after * (e.g., d0.w*2 or d0.w*scale)",
    },
  );
}

export function invalidBaseRegister(
  register: string,
  loc: Location,
): ParseError {
  return createError(
    "INVALID_BASE_REGISTER",
    `Invalid base register '${register}' - address register required`,
    loc,
    {
      expected: ["a0-a7", "sp", "macro parameter", "symbol"],
      got: register,
      hint: "Base register must be an address register (a0-a7, sp), not a data register (d0-d7)",
    },
  );
}

export function invalidIdentifier(
  identifier: string,
  loc: Location,
  context?: string,
): ParseError {
  const contextStr = context ? ` in ${context}` : "";
  return createError(
    "INVALID_IDENTIFIER",
    `Invalid identifier '${identifier}'${contextStr}`,
    loc,
    {
      got: identifier,
      hint: "Identifiers must start with a letter, underscore, or dot and contain only letters, digits, underscores, dots, $, or \\",
    },
  );
}

export function invalidIndexSize(got: string, loc: Location): ParseError {
  return createError("INVALID_INDEX_SIZE", `Invalid index size '${got}'`, loc, {
    expected: ["w", "l"],
    got,
    hint: "Index size must be .w (word) or .l (long)",
  });
}

export function unterminatedBlock(
  opener: string,
  expected: readonly string[],
  loc: Location,
): ParseError {
  return createError(
    "UNTERMINATED_BLOCK",
    `Unterminated '${opener}' block`,
    loc,
    {
      expected: [...expected],
      hint: `Add ${expected.map((e) => `'${e}'`).join(" or ")} to close it`,
    },
  );
}

export function unexpectedBlockTerminator(
  terminator: string,
  loc: Location,
): ParseError {
  return createError(
    "UNEXPECTED_BLOCK_TERMINATOR",
    `'${terminator}' without a matching block`,
    loc,
    { got: terminator },
  );
}

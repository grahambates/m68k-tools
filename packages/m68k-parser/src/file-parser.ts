import { parseLine } from "./line-parser.js";
import { type ParsedFile, type ParsedLine, type ParseError } from "./types.js";

/**
 * Parse an entire source file (multiple lines)
 * @param source - The source code as a string (can contain multiple lines)
 * @returns ParsedFile object with all parsed lines and aggregated error information
 */
export function parseFile(source: string): ParsedFile {
  // Normalize line endings to \n
  const normalizedSource = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split into lines
  const textLines = normalizedSource.split("\n");

  const lines: ParsedLine[] = [];
  const errors: ParseError[] = [];

  textLines.forEach((text, index) => {
    const { value, errors: lineErrors } = parseLine(text, index + 1);
    lines.push(value);
    errors.push(...lineErrors);
  });

  return { lines, errors };
}

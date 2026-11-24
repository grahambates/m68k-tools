import {
  evaluateConstant,
  locationAsRange,
  type ExpressionNode,
  type ParsedFile,
} from "m68k-parser";
import { CUSTOM_BASE, customRegisterSymbols } from "@m68k-lsp/platforms";
import type * as lsp from "vscode-languageserver";
import { registerWrite } from "./amigaHardware";

const COLOUR_REGISTER = /^COLOR(0\d|[12]\d|3[01])$/;

/** BPLCON3's LOCT bit: COLORxx writes set the low nibbles of AGA's 24-bit colour. */
const LOCT = 0x0200;

/** A symbol's value, where the project defines one. */
export type ConstantLookup = (name: string) => number | undefined;

/**
 * Which writes count: to registers named as the includes name them, and to
 * registers given by address, found by `addressed` for an operand of a line.
 */
export interface ColourWriteOptions {
  named: boolean;
  addressed?: (
    line: number,
    operand: number,
  ) => { name: string; value: ExpressionNode } | undefined;
}

/**
 * The values written to Amiga colour registers named as the includes name
 * them, by `move.w #$0f80,color00(a6)` or in a copper list as
 * `dc.w COLOR00,$0f80`, or given by address where `options` finds those, with
 * the line each is on.
 *
 * A register symbol the project defines as something else is passed over, as
 * for its hover. On AGA, a write while BPLCON3's LOCT bit is set gives the low
 * nibbles of a 24-bit colour, so it is no colour on its own: BPLCON3 writes
 * are followed through the file in order, starting afresh at each global
 * label, a new routine or copper list, and while LOCT is or may be set the
 * colour writes are left out.
 */
function colourWrites(
  parsed: ParsedFile,
  constant: ConstantLookup,
  options: ColourWriteOptions,
): { line: number; value: ExpressionNode }[] {
  const writes: { line: number; value: ExpressionNode }[] = [];
  const isRegister = (name: string) => {
    const offset = customRegisterSymbols.get(name.toLowerCase());
    if (offset === undefined) return false;
    const own = constant(name);
    return own === undefined || own === offset || own === CUSTOM_BASE + offset;
  };
  // Whether LOCT may be set: undefined where a BPLCON3 value is not known.
  let lowNibbles: boolean | undefined = false;

  for (const [line, parsedLine] of parsed.lines.entries()) {
    if (parsedLine.label?.scope === "global") lowNibbles = false;
    const count = parsedLine.operands?.length ?? 0;
    for (let operand = 0; operand < count; operand++) {
      const named = options.named
        ? registerWrite(parsedLine, operand)
        : undefined;
      const write =
        named && isRegister(named.register.name)
          ? { name: named.register.name, value: named.value }
          : named
            ? undefined
            : options.addressed?.(line, operand);
      if (!write) continue;
      const name = write.name.toUpperCase();
      if (name === "BPLCON3") {
        const result = evaluateConstant(write.value, constant);
        lowNibbles = result.known ? (result.value & LOCT) !== 0 : undefined;
      } else if (COLOUR_REGISTER.test(name) && lowNibbles === false) {
        writes.push({ line, value: write.value });
      }
    }
  }
  return writes;
}

const isLiteral = (value: ExpressionNode) =>
  value.type === "numeric-literal" && value.format !== "float";

/**
 * Colour swatches for the values written to colour registers: number
 * literals, and constants whose value is known. Not other expressions, which
 * the picker could only overwrite with a number.
 */
export function documentColours(
  parsed: ParsedFile,
  constant: ConstantLookup,
  options: ColourWriteOptions,
): lsp.ColorInformation[] {
  return colourWrites(parsed, constant, options).flatMap(({ line, value }) => {
    const known =
      value.type === "numeric-literal" && isLiteral(value)
        ? value.value
        : value.type === "symbol"
          ? constant(value.name)
          : undefined;
    return known === undefined
      ? []
      : [
          {
            range: locationAsRange(value.loc, line),
            color: amigaColour(known),
          },
        ];
  });
}

/** The constants a file writes to colour registers, by name. */
export function colourConstants(
  parsed: ParsedFile,
  constant: ConstantLookup,
  options: ColourWriteOptions,
): string[] {
  return colourWrites(parsed, constant, options).flatMap(({ value }) =>
    value.type === "symbol" ? [value.name] : [],
  );
}

/**
 * The number literal a constant is defined as on a line, `RED equ $f80`, for
 * the colour picker to edit, or undefined where it is not one.
 */
export function definitionLiteral(
  parsed: ParsedFile,
  line: number,
): { range: lsp.Range; value: number } | undefined {
  const source = parsed.lines[line];
  const directive =
    source?.mnemonic?.type === "directive"
      ? source.mnemonic.directive.toLowerCase()
      : undefined;
  const operand =
    source?.operands?.length === 1 ? source.operands[0] : undefined;
  if (
    source?.label?.scope !== "global" ||
    (directive !== "equ" && directive !== "=") ||
    operand?.type !== "value" ||
    operand.value.type !== "numeric-literal" ||
    !isLiteral(operand.value)
  )
    return undefined;
  return {
    range: locationAsRange(operand.value.loc, line),
    value: operand.value.value,
  };
}

/**
 * Swatches on the definitions of constants used as colours, so the picker can
 * change a colour where it is defined: `RED equ $f80`.
 *
 * @param isColour Whether a constant, by its label, is written to a colour register.
 */
export function definitionColours(
  parsed: ParsedFile,
  isColour: (name: string) => boolean,
): lsp.ColorInformation[] {
  return parsed.lines.flatMap((source, line) => {
    const literal =
      source.label && isColour(source.label.label)
        ? definitionLiteral(parsed, line)
        : undefined;
    return literal
      ? [{ range: literal.range, color: amigaColour(literal.value) }]
      : [];
  });
}

/** A 12-bit $RGB colour register value as a colour. */
export function amigaColour(value: number): lsp.Color {
  const component = (shift: number) => ((value >> shift) & 0xf) / 15;
  return {
    red: component(8),
    green: component(4),
    blue: component(0),
    alpha: 1,
  };
}

/**
 * A colour as a colour register value, written as `original` was: the same
 * base and number of digits, keeping its top four bits, such as AGA's
 * transparency bit. Hexadecimal letters follow the original's case, then the
 * formatter's where the original has no letters to go by, and are upper case
 * where neither says. The original comes first because the formatter's case
 * has a default, which says nothing of how the source is written.
 */
export function colourLiteral(
  colour: lsp.Color,
  original: string,
  hexCase?: "upper" | "lower" | "any",
): string {
  const nibble = (component: number) =>
    Math.max(0, Math.min(15, Math.round(component * 15)));
  const parsed = parseLiteral(original);
  const value =
    (parsed.value & 0xf000) |
    (nibble(colour.red) << 8) |
    (nibble(colour.green) << 4) |
    nibble(colour.blue);

  if (parsed.base === 10) return String(value);
  const digits = value.toString(parsed.base);
  const padded = digits.padStart(parsed.digits, "0");
  const letterCase =
    parsed.letterCase ?? (hexCase === "any" ? undefined : hexCase);
  const lower = letterCase === "lower";
  const cased = lower ? padded.toLowerCase() : padded.toUpperCase();
  return parsed.prefix + cased;
}

function parseLiteral(text: string): {
  base: number;
  prefix: string;
  digits: number;
  letterCase?: "upper" | "lower";
  value: number;
} {
  const match = /^(\$|0x|%|@)?([0-9a-fA-F]+)$/.exec(text.trim());
  if (!match) return { base: 16, prefix: "$", digits: 3, value: 0 };
  const [, prefix = "", digits] = match;
  const base =
    prefix === "$" || prefix === "0x"
      ? 16
      : prefix === "%"
        ? 2
        : prefix === "@"
          ? 8
          : 10;
  return {
    base,
    prefix,
    digits: digits.length,
    letterCase: /[a-f]/.test(digits)
      ? "lower"
      : /[A-F]/.test(digits)
        ? "upper"
        : undefined,
    value: parseInt(digits, base) || 0,
  };
}

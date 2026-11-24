import type { ExpressionNode, ParsedLine } from "m68k-parser";
import {
  CUSTOM_BASE,
  customRegisterAt,
  customRegisterSymbols,
  decodeRegisterValue,
  flagSymbol,
  hardwareManualUrl,
  registerDoc,
  type RegisterBit,
  type RegisterDoc,
} from "@m68k-lsp/platforms";

/**
 * Documentation for a standard Amiga hardware symbol: a custom chip register
 * named as the includes name it (`intena`, `INTENA`, `COP1LC`), or a flag from
 * them (`DMAF_SPRITE`, `INTB_VERTB`), in any case.
 *
 * The name is the evidence, so nothing is shown for code that only happens to
 * use these numbers. Where the symbol's value is known it must also agree:
 * the register's offset from $DFF000 or its absolute address, or the flag's
 * mask or bit number. A project that defines its own `intena` as something
 * else is not talking about the register. Where the value is not known, as
 * when the includes define the offsets with structure macros, the name decides.
 */
export function amigaHardwareDocs(
  name: string,
  value: number | undefined,
): string | undefined {
  return registerDocs(name, value) ?? flagDocs(name, value);
}

const hex = (value: number, digits = 0) =>
  "$" + value.toString(16).toUpperCase().padStart(digits, "0");

function registerDocs(
  name: string,
  value: number | undefined,
): string | undefined {
  const offset = customRegisterSymbols.get(name.toLowerCase());
  if (offset === undefined) return;
  if (value !== undefined && value !== offset && value !== CUSTOM_BASE + offset)
    return;
  const doc = registerDoc(name);
  if (!doc) return;

  const register = customRegisterAt(CUSTOM_BASE + offset);
  const upper = name.toUpperCase();
  // A pointer pair named as one long register is written with a long MOVE.
  const long = register && register.name !== upper;
  // The register's own chip set before its family's: BPL7PTH is AGA though
  // the BPLxPTH description covers the original planes too.
  const chipset = register?.chipset ?? doc.chipset;
  const header = [
    `**${upper}**`,
    hex(CUSTOM_BASE + offset),
    long
      ? `long, ${register.name}/${upper}L`
      : register?.access === "read-only"
        ? "read"
        : "write",
    ...(chipset ? [chipset] : []),
  ];
  const others = doc.names
    .filter((other) => other !== upper && !other.includes("x"))
    .flatMap((other) => {
      const otherOffset = customRegisterSymbols.get(other.toLowerCase());
      const otherRegister =
        otherOffset !== undefined
          ? customRegisterAt(CUSTOM_BASE + otherOffset)
          : undefined;
      return otherRegister && !long
        ? [
            `${other} ${hex(CUSTOM_BASE + otherRegister.offset)}, ${otherRegister.access === "read-only" ? "read" : "write"}`,
          ]
        : [];
    });

  return [
    header.join(" · ") +
      (others.length ? ` *(also ${others.join("; ")})*` : ""),
    doc.summary,
    bitTable(doc),
    manualLink(register?.name ?? upper),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function flagDocs(name: string, value: number | undefined): string | undefined {
  const flag = flagSymbol(name);
  if (!flag) return;
  const numbers = flag.bits.map((bit) => bit.bits as number);
  const mask = numbers.reduce((all, bit) => all | (1 << bit), 0);
  if (value !== undefined && value !== (flag.bitNumber ? numbers[0] : mask))
    return;

  const registers = flag.docs.map((doc) => doc.names[0]).join("/");
  const where =
    numbers.length === 1
      ? `bit ${numbers[0]}`
      : `bits ${Math.max(...numbers)}–${Math.min(...numbers)}`;
  const header = [
    `**${name.toUpperCase()}**`,
    `${registers} ${where}`,
    ...(flag.bitNumber ? [] : [`mask ${hex(mask, 4)}`]),
  ].join(" · ");
  const lines = flag.bits.map(
    (bit) => `${bit.name ? `${bit.name}: ` : ""}${describe(bit)}`,
  );
  return [header, lines.join("  \n"), manualLink(flag.docs[0].names[0])]
    .filter(Boolean)
    .join("\n\n");
}

function describe(bit: RegisterBit): string {
  return [
    bit.level !== undefined ? `Level ${bit.level}: ` : "",
    bit.text,
    bit.readOnly ? " (read only)" : "",
    bit.chipset ? ` (${bit.chipset})` : "",
  ].join("");
}

function bitTable(doc: RegisterDoc): string | undefined {
  if (!doc.bits?.length) return;
  const rows = doc.bits.map((bit) => {
    const where =
      typeof bit.bits === "number" ? bit.bits : `${bit.bits[0]}–${bit.bits[1]}`;
    return `| ${where} | ${bit.name ?? ""} | ${describe(bit)} |`;
  });
  return ["| Bit | Name | |", "|--:|---|---|", ...rows].join("\n");
}

function manualLink(name: string): string | undefined {
  const url = hardwareManualUrl(name);
  return url && `[Hardware Reference Manual](${url})`;
}

/**
 * The value the includes give a standard flag (`DMAF_SPRITE` is $0020,
 * `INTB_VERTB` is 5), for working out a value written to a register when the
 * includes themselves are not to hand. A symbol the project defines keeps its
 * own value; this is only for one it does not.
 */
export function standardFlagValue(name: string): number | undefined {
  const flag = flagSymbol(name);
  if (!flag) return undefined;
  const numbers = flag.bits.map((bit) => bit.bits as number);
  return flag.bitNumber
    ? numbers[0]
    : numbers.reduce((mask, bit) => mask | (1 << bit), 0);
}

/** A value being written to a register named as the includes name it. */
export interface RegisterWrite {
  /** The register symbol, as written. */
  register: ExpressionNode & { type: "symbol"; name: string };
  /** The value written. */
  value: ExpressionNode;
}

const isRegisterSymbol = (
  expr: ExpressionNode | undefined,
): expr is ExpressionNode & { type: "symbol"; name: string } =>
  expr?.type === "symbol" && customRegisterSymbols.has(expr.name.toLowerCase());

/**
 * The register a destination operand names: `dmacon(a6)`, `custom+dmacon`, or
 * the register symbol alone.
 */
function namedRegister(
  operand: NonNullable<ParsedLine["operands"]>[number],
): RegisterWrite["register"] | undefined {
  const expr =
    operand.type === "address-register-indirect-displacement"
      ? operand.displacement
      : operand.type === "absolute-address"
        ? operand.address
        : undefined;
  if (isRegisterSymbol(expr)) return expr;
  if (expr?.type === "binary-op" && expr.operator === "+") {
    if (isRegisterSymbol(expr.right)) return expr.right;
    if (isRegisterSymbol(expr.left)) return expr.left;
  }
  return undefined;
}

/**
 * The write the operand at `index` provides the value for, if any: the
 * immediate of `move.w #value,dmacon(a6)`, or the value in a copper list pair,
 * `dc.w DMACON,value`. Only whole-word writes: `or` and `and` change some bits
 * and leave the rest, and a long write covers two registers.
 */
export function registerWrite(
  line: ParsedLine,
  index: number,
): RegisterWrite | undefined {
  const operands = line.operands ?? [];
  const operand = operands[index];
  const size = line.qualifier?.type === "size" ? line.qualifier.size : "w";
  if (!operand || size.toLowerCase() !== "w") return undefined;
  const mnemonic = line.mnemonic;

  if (
    mnemonic?.type === "instruction" &&
    mnemonic.instruction.toLowerCase() === "move" &&
    index === 0 &&
    operand.type === "immediate" &&
    operand.value.type !== "string-literal" &&
    operands[1]
  ) {
    const register = namedRegister(operands[1]);
    return register && { register, value: operand.value as ExpressionNode };
  }

  if (
    mnemonic?.type === "directive" &&
    mnemonic.directive.toLowerCase() === "dc" &&
    index % 2 === 1 &&
    operand.type === "value"
  ) {
    const previous = operands[index - 1];
    const register =
      previous?.type === "value" && isRegisterSymbol(previous.value)
        ? previous.value
        : undefined;
    return register && { register, value: operand.value };
  }
  return undefined;
}

/**
 * What a value written to a register does, bit by bit, or undefined for a
 * register whose bits are not described. `registerValue` is the register
 * symbol's own value, where known, which must agree as for its hover.
 */
export function registerWriteDocs(
  name: string,
  registerValue: number | undefined,
  value: number,
): string | undefined {
  const offset = customRegisterSymbols.get(name.toLowerCase());
  if (offset === undefined) return;
  if (
    registerValue !== undefined &&
    registerValue !== offset &&
    registerValue !== CUSTOM_BASE + offset
  )
    return;
  const doc = registerDoc(name);
  const decoded = doc && decodeRegisterValue(doc, value);
  if (!decoded) return;

  const parts: string[] = [];
  const flags = decoded.flags.map((bit) => bit.name ?? bit.text);
  if (decoded.setClear) {
    parts.push(
      `${decoded.setClear === "set" ? "Sets" : "Clears"} ${flags.join(", ") || "nothing"}`,
    );
  } else {
    // Bits and fields in the order they sit in the register.
    const items = [
      ...decoded.flags.map((bit) => ({ bit, text: bit.name ?? bit.text })),
      ...decoded.fields.map(({ bit, value }) => ({
        bit,
        text: `${fieldName(bit.name)} = ${value}`,
      })),
    ].sort((a, b) => highBit(b.bit.bits) - highBit(a.bit.bits));
    parts.push(items.map(({ text }) => text).join(" · ") || "No bits set");
  }
  if (decoded.unknown.length)
    parts.push(`Bits not described here: ${decoded.unknown.join(", ")}`);

  return `Written to **${name.toUpperCase()}**: ${parts.join(". ")}`;
}

const highBit = (bits: number | readonly [number, number]) =>
  typeof bits === "number" ? bits : bits[0];

/** A field's name without its bit range: BPU for BPU2–BPU0. */
function fieldName(name: string | undefined): string {
  if (!name) return "Value";
  const [high, low] = name.split("–");
  if (!low) return name;
  const prefix = /^(.*?)\d+$/.exec(high)?.[1];
  return prefix && low.startsWith(prefix) ? prefix : name;
}

import type { ExpressionNode, ParsedLine } from "m68k-parser";
import {
  CUSTOM_BASE,
  ciaManualUrl,
  customRegisterAt,
  customRegisterSymbols,
  decodeRegisterValue,
  describeMinterm,
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

export const hex = (value: number, digits = 0) =>
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

  const registers = flag.docs.map(registerLabel).join("/");
  const where =
    numbers.length === 1
      ? `bit ${numbers[0]}`
      : `bits ${Math.max(...numbers)}–${Math.min(...numbers)}`;
  const header = [
    `**${name.toUpperCase()}**`,
    `${registers} ${where}`,
    ...(flag.bitNumber
      ? []
      : [`mask ${hex(mask, flag.docs[0].width === 8 ? 2 : 4)}`]),
  ].join(" · ");
  const lines = flag.bits.map(
    (bit) => `${bit.name ? `${bit.name}: ` : ""}${describe(bit)}`,
  );
  const [doc] = flag.docs;
  const link =
    doc.width === 8 ? ciaLink(doc.names[0]) : manualLink(doc.names[0]);
  return [header, lines.join("  \n"), link].filter(Boolean).join("\n\n");
}

/** A register's name, with its CIA where the description is for one: CIA-A PRA. */
export const registerLabel = (doc: RegisterDoc) =>
  doc.cia ? `CIA-${doc.cia} ${doc.names[0]}` : doc.names[0];

/** A link to the Hardware Reference Manual's page on a CIA register. */
export const ciaLink = (name?: string) =>
  `[Hardware Reference Manual](${ciaManualUrl(name)})`;

export function describe(bit: RegisterBit): string {
  return [
    bit.level !== undefined ? `Level ${bit.level}: ` : "",
    bit.text,
    bit.readOnly ? " (read only)" : "",
    bit.chipset ? ` (${bit.chipset})` : "",
  ].join("");
}

export function bitTable(doc: RegisterDoc): string | undefined {
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

/** Whether an operand names a custom register as the includes name it. */
export const namedRegisterOperand = (
  operand: NonNullable<ParsedLine["operands"]>[number],
) => namedRegister(operand) !== undefined;

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
  return doc && describeWrite(name.toUpperCase(), doc, value);
}

/**
 * A value written to a register, read against its bits, under the register's
 * name, or undefined for one whose bits are not described.
 */
export function describeWrite(
  label: string,
  doc: RegisterDoc,
  value: number,
): string | undefined {
  const decoded = decodeRegisterValue(doc, value);
  if (!decoded) return;

  const parts: string[] = [];
  if (decoded.setClear) {
    const flags = labels(decoded.flags);
    parts.push(
      `${decoded.setClear === "set" ? "Sets" : "Clears"} ${flags.join(", ") || "nothing"}`,
    );
  } else {
    // A field a later chip set added is left out at 0, as it is in code for
    // the original chips: BPLCON1's AGA scroll bits would otherwise crowd out
    // the two that matter.
    const fields = decoded.fields.filter(
      ({ bit, value }) => value !== 0 || !bit.chipset,
    );
    // Bits and fields in the order they sit in the register.
    const items = [
      ...decoded.flags.map((bit) => ({ bit, value: undefined })),
      ...fields,
    ].sort((a, b) => highBit(b.bit.bits) - highBit(a.bit.bits));
    const names = labels(items.map(({ bit }) => bit));
    parts.push(
      items
        .map(({ bit, value }, i) =>
          value === undefined
            ? names[i]
            : bit.minterm
              ? `${names[i]} = ${minterm(value)}`
              : `${names[i]} = ${value}`,
        )
        .join(" · ") || "No bits set",
    );
  }
  if (decoded.unknown.length)
    parts.push(`Bits not described here: ${decoded.unknown.join(", ")}`);

  return `Written to **${label}**: ${parts.join(". ")}`;
}

/** A blitter logic function, with its equation: $CA (D = AB + ¬AC, cookie-cut). */
function minterm(value: number): string {
  const { equation, name } = describeMinterm(value);
  return `${hex(value, 2)} (${[equation, name].filter(Boolean).join(", ")})`;
}

const highBit = (bits: number | readonly [number, number]) =>
  typeof bits === "number" ? bits : bits[0];

/**
 * What to call each bit or field shown together: a field by its name without
 * the bit range, BPU for BPU2–BPU0, where that is the only one so called; by
 * its full name where it is not, as for BPLCON1's PF2H7–PF2H6 beside
 * PF2H3–PF2H0; and by its description where even that is shared, as for
 * DIWHIGH's two V10–V8 fields, one for the start and one for the stop.
 */
function labels(bits: readonly RegisterBit[]): string[] {
  const count = (names: string[]) => {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  };
  const full = bits.map((bit) => bit.name ?? plainText(bit));
  const short = bits.map((bit) =>
    typeof bit.bits === "number"
      ? (bit.name ?? plainText(bit))
      : fieldName(bit.name),
  );
  const shortCounts = count(short);
  const fullCounts = count(full);
  return bits.map((bit, i) =>
    shortCounts.get(short[i]) === 1
      ? short[i]
      : fullCounts.get(full[i]) === 1
        ? full[i]
        : plainText(bit),
  );
}

/** A bit's description without any note in parentheses, to name it by. */
const plainText = (bit: RegisterBit) => bit.text.replace(/\s*\([^)]*\)/g, "");

/** A field's name without its bit range: BPU for BPU2–BPU0. */
function fieldName(name: string | undefined): string {
  if (!name) return "Value";
  const [high, low] = name.split("–");
  if (!low) return name;
  const prefix = /^(.*?)\d+$/.exec(high)?.[1];
  return prefix && low.startsWith(prefix) ? prefix : name;
}

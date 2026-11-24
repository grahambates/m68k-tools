import type { ExpressionNode, ParsedLine } from "m68k-parser";
import {
  CIA_BASE,
  ciaBase,
  ciaDocsFor,
  ciaRegister,
  type Cia,
  type CiaRegister,
} from "@m68k-lsp/platforms";
import type { RegisterDoc } from "@m68k-lsp/platforms";
import {
  bitTable,
  ciaLink,
  describe,
  describeWrite,
  hex,
} from "./amigaHardware";

/** A symbol's value, where the project defines one. */
type Lookup = (name: string) => number | undefined;

/** A CIA register an operand names, and the CIA where it says which. */
export interface CiaOperand {
  register: CiaRegister;
  cia?: Cia;
}

type Symbol = ExpressionNode & { type: "symbol"; name: string };
const asSymbol = (expr: ExpressionNode | undefined): Symbol | undefined =>
  expr?.type === "symbol" ? (expr as Symbol) : undefined;

/**
 * Whether a CIA register symbol is that register: its value, where the project
 * defines one, is the register's offset or its address on one of the CIAs,
 * which then says which CIA. Undefined where the value says it is not.
 */
function checkRegister(
  register: CiaRegister,
  own: number | undefined,
): { cia?: Cia } | undefined {
  if (own === undefined || own === register.offset) return {};
  for (const cia of ["A", "B"] as const)
    if (own === CIA_BASE[cia] + register.offset) return { cia };
  return undefined;
}

/** Whether a base symbol is its CIA's address, where the project defines it. */
const checkBase = (cia: Cia, own: number | undefined) =>
  own === undefined || own === CIA_BASE[cia];

/**
 * The CIA register an operand names as the includes name them: the base alone
 * for PRA, `ciaa`; the base and a register, `ciaa+ciaicr` in either order; or
 * a register from an address register, `ciaicr(a0)`, where the CIA is not
 * said.
 */
export function ciaOperand(
  operand: NonNullable<ParsedLine["operands"]>[number],
  lookup: Lookup,
): CiaOperand | undefined {
  if (operand.type === "address-register-indirect-displacement") {
    const symbol = asSymbol(operand.displacement);
    const register = symbol && ciaRegister(symbol.name);
    const check = register && checkRegister(register, lookup(symbol.name));
    return register && check ? { register, cia: check.cia } : undefined;
  }
  if (operand.type !== "absolute-address") return undefined;
  const expr = operand.address;
  const parts =
    expr.type === "binary-op" && expr.operator === "+"
      ? [asSymbol(expr.left), asSymbol(expr.right)]
      : [asSymbol(expr)];
  if (parts.some((part) => !part)) return undefined;

  let cia: Cia | undefined;
  let register: CiaRegister | undefined;
  for (const part of parts as Symbol[]) {
    const base = ciaBase(part.name);
    if (base) {
      if (cia || !checkBase(base, lookup(part.name))) return undefined;
      cia = base;
      continue;
    }
    const named = ciaRegister(part.name);
    const check = named && checkRegister(named, lookup(part.name));
    if (!named || !check || register) return undefined;
    register = named;
    if (check.cia) cia = check.cia;
  }
  // The base alone is the CIA's first register.
  if (!register && cia) register = ciaRegister("ciapra");
  return register ? { register, cia } : undefined;
}

/**
 * The register an operand names, with its CIA where the operand or the
 * description says: TAHI, not the TALO it shares a description with.
 */
const label = (operand: CiaOperand, doc: RegisterDoc) => {
  const cia = doc.cia ?? operand.cia;
  return cia ? `CIA-${cia} ${operand.register.name}` : operand.register.name;
};

const address = (register: CiaRegister, cia: Cia) =>
  hex(CIA_BASE[cia] + register.offset);

/**
 * Documentation for a CIA symbol from the includes: a register offset such as
 * `ciapra`, or a base such as `_ciaa`. `cia` is the CIA, where the operand it
 * is in says.
 */
export function ciaSymbolDocs(
  name: string,
  value: number | undefined,
  cia?: Cia,
): string | undefined {
  const base = ciaBase(name);
  if (base) return checkBase(base, value) ? baseDocs(name, base) : undefined;

  const register = ciaRegister(name);
  const check = register && checkRegister(register, value);
  if (!register || !check) return;
  const which = check.cia ?? cia;
  const docs = ciaDocsFor(register.name, which);
  const where = which
    ? `CIA-${which} ${register.name} · ${address(register, which)}`
    : `${register.name} · CIA-A ${address(register, "A")}, CIA-B ${address(register, "B")}`;
  // The port registers differ between the CIAs; each says which it is.
  const sections = docs.map((doc) =>
    [
      docs.length > 1 && doc.cia
        ? `**CIA-${doc.cia}:** ${doc.summary}`
        : doc.summary,
      bitTable(doc),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  return [
    `**${name.toUpperCase()}** · ${where}`,
    ...sections,
    ciaLink(register.name),
  ].join("\n\n");
}

function baseDocs(name: string, cia: Cia): string {
  const summary =
    cia === "A"
      ? "CIA-A: fire buttons, disk status, the power LED, the keyboard and parallel port data, and two timers and a vertical blank counter, interrupting at level 2. Its registers are on odd bytes, every $100."
      : "CIA-B: serial handshake lines, parallel port status and floppy drive control, and two timers and a horizontal sync counter, interrupting at level 6. Its registers are on even bytes, every $100.";
  return [
    `**${name.toUpperCase()}** · CIA-${cia} · ${hex(CIA_BASE[cia])}`,
    `${summary} Read and write them a byte at a time.`,
    ciaLink(),
  ].join("\n\n");
}

/**
 * What a bit of a CIA register is, for a bit tested or changed by `btst`,
 * `bset`, `bclr` or `bchg`: `btst #6,ciaa` tests the left mouse button.
 */
export function ciaBitDocs(
  operand: CiaOperand,
  bit: number,
): string | undefined {
  if (bit < 0 || bit > 7) return;
  const lines = ciaDocsFor(operand.register.name, operand.cia).flatMap(
    (doc) => {
      const found = doc.bits?.find((b) =>
        typeof b.bits === "number"
          ? b.bits === bit
          : bit <= b.bits[0] && bit >= b.bits[1],
      );
      return found
        ? [
            `Bit ${bit} of **${label(operand, doc)}**: ${found.name ? `${found.name} · ` : ""}${describe(found)}`,
          ]
        : [];
    },
  );
  return lines.length ? lines.join("  \n") : undefined;
}

/** A byte written to a CIA register, read against its bits. */
export function ciaWriteDocs(
  operand: CiaOperand,
  value: number,
): string | undefined {
  const lines = ciaDocsFor(operand.register.name, operand.cia).flatMap(
    (doc) => {
      const text = describeWrite(label(operand, doc), doc, value);
      return text ? [text] : [];
    },
  );
  return lines.length ? lines.join("  \n") : undefined;
}

const bitInstructions = new Set(["btst", "bset", "bclr", "bchg"]);

/**
 * How the operand at `index` relates to a named CIA register, for hover: the
 * bit number of a bit instruction on one, or a byte moved into one.
 */
export function ciaAccess(
  line: ParsedLine,
  index: number,
  lookup: Lookup,
):
  | { kind: "bit" | "write"; value: ExpressionNode; operand: CiaOperand }
  | undefined {
  const operands = line.operands ?? [];
  const source = operands[index];
  const destination = operands[1];
  if (
    index !== 0 ||
    source?.type !== "immediate" ||
    source.value.type === "string-literal" ||
    !destination ||
    line.mnemonic?.type !== "instruction"
  )
    return undefined;
  const mnemonic = line.mnemonic.instruction.toLowerCase();
  const size =
    line.qualifier?.type === "size" ? line.qualifier.size : undefined;
  const kind = bitInstructions.has(mnemonic)
    ? "bit"
    : mnemonic === "move" && size?.toLowerCase() === "b"
      ? "write"
      : undefined;
  const operand = kind && ciaOperand(destination, lookup);
  return kind && operand
    ? { kind, value: source.value as ExpressionNode, operand }
    : undefined;
}

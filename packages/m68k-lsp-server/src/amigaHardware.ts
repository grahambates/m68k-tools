import {
  CUSTOM_BASE,
  customRegisterAt,
  customRegisterSymbols,
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
  const header = [
    `**${upper}**`,
    hex(CUSTOM_BASE + offset),
    long
      ? `long, ${register.name}/${upper}L`
      : register?.access === "read-only"
        ? "read"
        : "write",
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

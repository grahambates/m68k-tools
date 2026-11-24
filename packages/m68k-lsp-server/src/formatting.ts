import { type MarkupContent, MarkupKind } from "vscode-languageserver-types";
import {
  addressingModeDocs,
  type AddressingModes,
  isInstructionDoc,
  type MnemonicDoc,
} from "./docs";
import { type AddressingMode } from "./syntax";

export function formatDeclaration(definitionLine: string) {
  return definitionLine
    .split(/(;|\* )/)[0] // Remove comment
    .replace(/\s+/g, " ") // Collapse whitespace
    .trimEnd();
}

export function formatNumeric(text: string): string {
  return formatNumber(
    Number(text.replace("$", "0x").replace("%", "0b").replace("@", "0o")),
  );
}

/**
 * A value in decimal, hexadecimal, binary and octal, and as characters, for
 * hover. A negative value is shown in decimal as it is and in the other bases
 * as its 32-bit pattern, as vasm stores it: -1 is $ffffffff.
 */
export function formatNumber(value: number): string {
  const bits = Number.isInteger(value) && value < 0 ? value >>> 0 : value;
  const hex = bits.toString(16).toUpperCase();
  const oct = bits.toString(8);
  const bin = bits.toString(2);
  // Characters that would otherwise be read as Markdown.
  const ascii = asciiValue(bits).replace(/([\\`*_[\]<&])/g, "\\$1");

  return `${value} | $${hex} | %${bin} | @${oct} | "${ascii}"`;
}

export function asciiValue(num: number) {
  // Unsigned shifts: a signed one would make a top byte of $80 or more
  // negative, and it would be dropped as if it were a leading zero.
  const bytes = [
    (num >>> 24) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 8) & 0xff,
    num & 0xff,
  ];
  const firstByte = bytes.findIndex((b) => b > 0);

  return bytes
    .slice(firstByte)
    .map((byte) =>
      byte < 32 || (byte > 127 && byte < 161) || byte > 255
        ? "."
        : String.fromCharCode(byte),
    )
    .join("");
}

export function formatMnemonicDoc(doc: MnemonicDoc): MarkupContent {
  let value = `\n\`\`\`vasmmot\n${doc.syntax.join("\n")}\n\`\`\`\n`; // TODO
  value += "\n***\n";

  value += "**" + doc.summary + "**";
  if (doc.description) {
    value += `\n\n${doc.description}`;
  }

  if (isInstructionDoc(doc)) {
    if (doc.ccr) {
      const cols = Object.values(doc.ccr);
      value += `\n\n| X | N | Z | V | C |\n|---|---|---|---|---|\n| ${cols.join(
        " | ",
      )} |`;
    }

    if (doc.conditionCodeDescription) {
      value += "\n\n" + doc.conditionCodeDescription;
    }

    const widths = [5, 5, 5, 5, 5, 5, 8, 5, 5, 5, 8, 5];

    if (doc.src || doc.dest) {
      value += `\n`;
      value += `\n|     |Dn   |An   |(An) |(An)+|-(An)|d(An)|d(An,Xi)|ABS.W|ABS.L|d(PC)|d(PC,Xn)|imm  |`;
      value += `\n|:----|-----|-----|-----|-----|-----|-----|--------|-----|-----|-----|--------|-----|`;
      if (doc.src) {
        const srcCols = Object.values(doc.src).map((v, i) =>
          (v ? "  ✓" : "  -").padEnd(widths[i], " "),
        );
        value += `\n|**src**  |${srcCols.join("|")}|`;
      }
      if (doc.dest) {
        const destCols = Object.values(doc.dest).map((v, i) =>
          (v ? "  ✓" : "  -").padEnd(widths[i], " "),
        );
        value += `\n|**dest** |${destCols.join("|")}|`;
      }
    }
  }

  return {
    kind: MarkupKind.Markdown,
    value,
  };
}

export function formatAddressingModes(addressing: AddressingModes): string {
  return Object.entries(addressing)
    .map(([key, allowed]) =>
      allowed ? addressingModeDocs[key as AddressingMode] : "",
    )
    .filter(Boolean)
    .join(", ");
}

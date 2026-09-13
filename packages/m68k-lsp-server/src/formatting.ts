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
  const value = Number(
    text.replace("$", "0x").replace("%", "0b").replace("@", "0o"),
  );
  const hex = value.toString(16);
  const oct = value.toString(8);
  const bin = value.toString(2);
  const ascii = asciiValue(value);

  return `${value} | $${hex} | %${bin} | @${oct} | "${ascii}"`;
}

export function asciiValue(num: number) {
  const bytes = [
    (num & 0xff000000) >> 24,
    (num & 0x00ff0000) >> 16,
    (num & 0x0000ff00) >> 8,
    num & 0x000000ff,
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

import type { Size } from "m68k-parser";
import { type Component } from "./parse";

export interface SignatureInfo {
  label: string;
  sizes: Size[];
  size?: Component;
  operands: Component[];
}

export function splitSignatureOperands(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (text.trim()) parts.push(text.slice(start).trim());
  return parts;
}

/**
 * Get components from syntax signature text.
 *
 * This parses the documented syntax of a mnemonic, e.g. `move.[bwl] <ea>,<ea>`,
 * not assembly source, so it stays hand-rolled rather than going through
 * m68k-parser.
 */
export function parseSignature(text: string): SignatureInfo {
  const info: SignatureInfo = { label: text, sizes: [], operands: [] };
  let end = 0;

  const space = text.indexOf(" ");
  const inst = space < 0 ? text : text.slice(0, space);
  const opList = space < 0 ? "" : text.slice(space + 1);
  const [, size] = inst.split(".");
  if (size) {
    const value = size.replace(/[\]]/g, "");
    const start = end + text.substring(end).indexOf(value);
    end = start + value.length;
    info.size = { start, end, value };
    info.sizes = <Size[]>value.replace(/[().]/g, "").split("");
  }

  if (opList) {
    for (const op of splitSignatureOperands(opList)) {
      const value = op.replace(/[[\]]/g, "");
      const start = end + text.substring(end).indexOf(value);
      end = start + value.length;
      info.operands.push({ start, end, value });
    }
  }

  return info;
}

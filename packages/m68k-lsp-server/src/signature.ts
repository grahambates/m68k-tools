import type { Size } from "m68k-parser";
import { type Component } from "./parse";

export interface SignatureInfo {
  label: string;
  sizes: Size[];
  size?: Component;
  operands: Component[];
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

  const [inst, opList] = text.split(" ");
  const [, size] = inst.split(".");
  if (size) {
    const value = size.replace(/[\]]/g, "");
    const start = end + text.substring(end).indexOf(value);
    end = start + value.length;
    info.size = { start, end, value };
    info.sizes = <Size[]>value.replace(/[().]/g, "").split("");
  }

  if (opList) {
    for (const op of opList.split(",")) {
      const value = op.replace(/[[\]]/g, "");
      const start = end + text.substring(end).indexOf(value);
      end = start + value.length;
      info.operands.push({ start, end, value });
    }
  }

  return info;
}

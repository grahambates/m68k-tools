import { parseLine, type OperandNode } from "m68k-parser";
import type { InstructionStatement } from "../parse/nodes";
import type { Variables } from "../parse/evaluate";
import { fullFormat } from "./ea68030";

export type CachedMode =
  | "dn"
  | "an"
  | "indirect"
  | "postinc"
  | "predec"
  | "disp"
  | "pcdisp"
  | "absolute"
  | "immediate"
  | "index"
  | "pcindex"
  | "full"
  | "pre"
  | "preOuter"
  | "post"
  | "postOuter"
  | "list";
export interface CachedOperand {
  mode: CachedMode;
  node: OperandNode;
  memory: boolean;
  pc: boolean;
  pointerReads: number;
  ea060: number;
  control: boolean;
  writable: boolean;
}

export function cachedOperands(
  statement: InstructionStatement,
  vars: Variables,
): CachedOperand[] | null {
  const { op, qualifier } = statement.opcode;
  const parsed = parseLine(
    ` ${op.text}${qualifier ? "." + qualifier.text : ""} ${statement.operands.map((o) => o.text).join(",")}`,
  );
  if (parsed.errors.length) return null;
  const result: CachedOperand[] = [];
  for (const node of parsed.value.operands ?? []) {
    const form = fullFormat(node, vars);
    if (form === null) return null;
    let mode: CachedMode;
    let pc = false;
    switch (node.type) {
      case "data-register":
        mode = "dn";
        break;
      case "address-register":
        mode = "an";
        break;
      case "address-register-indirect":
        mode = "indirect";
        break;
      case "address-register-indirect-postinc":
        mode = "postinc";
        break;
      case "address-register-indirect-predec":
        mode = "predec";
        break;
      case "address-register-indirect-displacement":
        mode = form ? "full" : "disp";
        break;
      case "address-register-indirect-index":
        mode = form ? "full" : "index";
        break;
      case "pc-relative":
        mode = form ? "full" : "pcdisp";
        pc = true;
        break;
      case "pc-relative-index":
        mode = form ? "full" : "pcindex";
        pc = true;
        break;
      case "absolute-address":
        mode = "absolute";
        break;
      case "immediate":
        mode = "immediate";
        break;
      case "register-list":
        mode = "list";
        break;
      case "memory-indirect": {
        const outer = form?.endsWith("16") || form?.endsWith("32");
        const post = node.indexRegister && node.indexPosition === "post";
        mode = post
          ? outer
            ? "postOuter"
            : "post"
          : outer
            ? "preOuter"
            : "pre";
        pc =
          node.baseRegister?.type === "symbol" &&
          node.baseRegister.name.toLowerCase() === "pc";
        break;
      }
      default:
        return null;
    }
    const memory = !["dn", "an", "immediate", "list"].includes(mode);
    const pointerReads = node.type === "memory-indirect" ? 1 : 0;
    result.push({
      mode,
      node,
      memory,
      pc,
      pointerReads,
      ea060: pointerReads ? 3 : mode === "full" ? 1 : 0,
      control: memory && mode !== "postinc" && mode !== "predec",
      writable: !pc && (memory || mode === "dn" || mode === "an"),
    });
  }
  return result;
}

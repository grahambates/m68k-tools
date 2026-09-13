import type { OperandNode } from "m68k-parser";
import type { AddressingModes, InstructionDoc } from "./docs";
import type { AddressingMode } from "./syntax";

type Match = boolean | undefined;

function splitOperands(text: string): string[] {
  const parts: string[] = [];
  let depth = 0,
    start = 0;
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

function forms(signature: string): string[][] {
  const space = signature.indexOf(" ");
  const text = space < 0 ? "" : signature.slice(space + 1);
  const optional = /\[([^[\]]*)\]/.exec(text);
  if (optional)
    return [
      splitOperands(text.replace(optional[0], "")),
      splitOperands(text.replace(optional[0], optional[1])),
    ];
  return [splitOperands(text)];
}

function mode(operand: OperandNode): AddressingMode | undefined {
  switch (operand.type) {
    case "absolute-address":
      return operand.addressSize?.type === "size" &&
        operand.addressSize.size === "w"
        ? "absW"
        : "absL";
    case "data-register":
      return "dn";
    case "address-register":
      return "an";
    case "immediate":
      return "imm";
    case "address-register-indirect":
      return "anIndirect";
    case "address-register-indirect-postinc":
      return "anPostInc";
    case "address-register-indirect-predec":
      return "anPreDec";
    case "address-register-indirect-displacement":
      return "anOffset";
    case "address-register-indirect-index":
      return "anIdx";
    case "pc-relative":
      return "pcOffset";
    case "pc-relative-index":
      return "pcIdx";
    default:
      return undefined;
  }
}

function allowed(operand: OperandNode, modes?: AddressingModes): Match {
  const addressing = mode(operand);
  if (!modes) return undefined;
  if (addressing) return modes[addressing];
  if (
    [
      "special-register",
      "register-list",
      "fpu-data-register",
      "fpu-control-register",
      "fpu-register-list",
      "register-pair",
      "string-literal",
    ].includes(operand.type)
  )
    return false;
  return undefined;
}

function matches(
  pattern: string,
  operand: OperandNode,
  doc: InstructionDoc,
  laterTst: boolean,
): Match {
  if (/^D[nxy]$/i.test(pattern)) return operand.type === "data-register";
  if (/^A[nxy]$/i.test(pattern)) return operand.type === "address-register";
  if (/^R[nxy]$/i.test(pattern))
    return ["data-register", "address-register"].includes(operand.type);
  if (/^FP[nxy]$/i.test(pattern)) return operand.type === "fpu-data-register";
  if (/^\(A[nxy]\)$/i.test(pattern))
    return operand.type === "address-register-indirect";
  if (/^-\(A[nxy]\)$/i.test(pattern))
    return operand.type === "address-register-indirect-predec";
  if (/^\(A[nxy]\)\+$/i.test(pattern))
    return operand.type === "address-register-indirect-postinc";
  if (/^\(d,A[nxy]\)$/i.test(pattern))
    return operand.type === "address-register-indirect-displacement";
  if (["<label>", "<literal>"].includes(pattern))
    return operand.type === "absolute-address"
      ? true
      : ["macro-parameter", "unknown"].includes(operand.type)
        ? undefined
        : false;
  if (pattern.startsWith("#")) return operand.type === "immediate";
  if (/^(CCR|SR|USP)$/i.test(pattern))
    return (
      operand.type === "special-register" &&
      operand.register.toUpperCase() === pattern.toUpperCase()
    );
  if (pattern === "<source>") return allowed(operand, doc.src);
  if (pattern === "<destination>") {
    if (laterTst && operand.type === "address-register") return true;
    return allowed(operand, doc.dest ?? doc.src);
  }
  if (["<count>", "<bit_number>"].includes(pattern))
    return ["data-register", "immediate"].includes(operand.type);
  if (pattern === "<register_list>")
    return ["register-list", "data-register", "address-register"].includes(
      operand.type,
    );
  // Documentation has informal placeholders and incomplete later-CPU forms.
  // Unknown is deliberately distinct from invalid.
  return undefined;
}

/** Reject only when every documented alternative has a definite mismatch. */
export function matchesInstructionForms(
  doc: InstructionDoc,
  operands: OperandNode[],
  laterTst = false,
): Match {
  if (!doc.syntax.length) return undefined;
  const name = doc.title.toLowerCase();
  const [source, destination] = operands;
  // The source/destination tables are unions of encodings, not a Cartesian
  // product: arithmetic/logical memory destinations require a data-register
  // source (or the assembler's immediate-instruction alias).
  if (
    ["add", "sub", "and", "or"].includes(name) &&
    source &&
    destination &&
    !["data-register", "address-register"].includes(destination.type) &&
    mode(destination) &&
    !["data-register", "immediate"].includes(source.type) &&
    mode(source)
  )
    return false;
  if (
    name === "move" &&
    destination?.type === "special-register" &&
    ["sr", "ccr"].includes(destination.register) &&
    source?.type === "address-register"
  )
    return false;

  const candidates = doc.syntax
    .flatMap(forms)
    .filter((form) => form.length === operands.length);
  if (!candidates.length) return undefined;
  const results = candidates.map((form) => {
    const checks = form.map((pattern, i) =>
      matches(pattern, operands[i], doc, laterTst),
    );
    return checks.includes(false)
      ? false
      : checks.includes(undefined)
        ? undefined
        : true;
  });
  return results.includes(true)
    ? true
    : results.includes(undefined)
      ? undefined
      : false;
}

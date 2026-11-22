import { addressingMode, type OperandNode } from "m68k-parser";
import type { AddressingModes, InstructionDoc } from "./docs";
import type { AddressingMode } from "./syntax";
import {
  parseSignature,
  splitSignatureOperands,
  type SignatureInfo,
} from "./signature";

type Match = boolean | undefined;

function forms(signature: string): string[][] {
  const space = signature.indexOf(" ");
  const text = space < 0 ? "" : signature.slice(space + 1);
  const optional = /\[([^[\]]*)\]/.exec(text);
  if (optional)
    return [
      splitSignatureOperands(text.replace(optional[0], "")),
      splitSignatureOperands(text.replace(optional[0], optional[1])),
    ];
  return [splitSignatureOperands(text)];
}

/** Compatible documented signatures, best match first. Unknown operands keep alternatives open. */
export function rankInstructionSignatures(
  doc: InstructionDoc,
  size: string | undefined,
  operands: readonly (OperandNode | undefined)[],
  activeOperand?: number,
): { signature: SignatureInfo; patterns: string[] }[] {
  return doc.syntax
    .map(parseSignature)
    .flatMap((signature) => {
      const explicitSize =
        size !== undefined && signature.sizes.some((item) => item === size);
      if (size && signature.sizes.length && !explicitSize) return [];
      return forms(signature.label).flatMap((patterns) => {
        if (
          patterns.length < operands.length ||
          (activeOperand !== undefined && activeOperand >= patterns.length)
        )
          return [];
        let score = explicitSize ? 1 : 0;
        for (const [index, operand] of operands.entries()) {
          if (!operand) continue;
          const pattern = patterns[index];
          const match = matches(pattern, operand, doc, false);
          if (match === false) return [];
          if (match) score++;
        }
        return [{ signature, patterns, score }];
      });
    })
    .sort((a, b) => b.score - a.score)
    .map(({ signature, patterns }) => ({ signature, patterns }));
}

/** The modes an instruction's documentation describes. */
const documented = new Set<string>([
  "dn",
  "an",
  "anIndirect",
  "anPostInc",
  "anPreDec",
  "anOffset",
  "anIdx",
  "absW",
  "absL",
  "pcOffset",
  "pcIdx",
  "imm",
]);

function mode(operand: OperandNode): AddressingMode | undefined {
  const found = addressingMode(operand);
  // Anything else -- a register list, a special register, memory indirect --
  // is not one of the documented modes, so it has none here.
  return found && documented.has(found) ? (found as AddressingMode) : undefined;
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

import { matchesInstructionForms } from "./instructionForms";
import { parseFile, type ParsedLine } from "m68k-parser";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { TextEdit } from "vscode-languageserver";
import { instructionDocs, type Processor } from "./docs";

/** Conservative checks for operand forms affected by register substitution. */
function issues(line: ParsedLine, processors: readonly Processor[]): string[] {
  if (line.mnemonic?.type !== "instruction") return [];
  let name = line.mnemonic.instruction.toLowerCase();
  const operands = line.operands ?? [];
  const messages: string[] = [];
  const byte = line.qualifier?.type === "size" && line.qualifier.size === "b";
  const destination = operands.at(-1);
  // Assemblers accept the generic spellings for address-register arithmetic.
  if (
    ["move", "add", "sub", "cmp"].includes(name) &&
    destination?.type === "address-register" &&
    operands[0]?.type !== "special-register"
  )
    name += "a";
  const doc = instructionDocs[name];
  const laterTst =
    name === "tst" &&
    processors.some((p) =>
      ["mc68020", "mc68030", "mc68040", "mc68060", "cpu32"].includes(p),
    );
  if (doc && matchesInstructionForms(doc, operands, laterTst) === false) {
    messages.push(
      `${name.toUpperCase()} operands do not match a documented form: ${doc.syntax.join(" or ")}`,
    );
  }
  for (const operand of operands) {
    if (
      operand.type === "data-register" ||
      operand.type === "address-register"
    ) {
      const address = operand.type === "address-register";
      if (address && byte)
        messages.push(
          "Address registers cannot be used with byte-sized instructions",
        );
    }
    // Index registers can be either class; the base of an indirect address cannot.
    const checkBase = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const value = node as Record<string, unknown>;
      if (typeof value.type === "string" && value.type.includes("indirect")) {
        for (const key of ["register", "baseRegister"]) {
          const base = value[key] as
            { register?: string; name?: string } | undefined;
          if (base && /^d[0-7]$/i.test(base.register ?? base.name ?? ""))
            messages.push(
              "An indirect address requires an address register as its base",
            );
        }
      }
      for (const child of Object.values(value))
        if (typeof child === "object") checkBase(child);
    };
    checkBase(operand);
  }
  return [...new Set(messages)];
}

export function registerRemapWarnings(
  document: TextDocument,
  edits: TextEdit[],
  processors: readonly Processor[],
): string[] {
  const before = parseFile(document.getText());
  const after = parseFile(TextDocument.applyEdits(document, edits));
  const changed = new Set(edits.map((e) => e.range.start.line));
  const warnings: string[] = [];
  for (const index of changed) {
    const old = before.lines[index],
      next = after.lines[index];
    if (!old || !next) continue;
    const existing = new Set(issues(old, processors));
    for (const message of issues(next, processors))
      if (!existing.has(message))
        warnings.push(`Line ${index + 1}: ${message}`);
    const previousErrors = new Set(
      before.errors
        .filter((e) => e.loc.line === index + 1)
        .map((e) => e.message),
    );
    for (const error of after.errors.filter((e) => e.loc.line === index + 1))
      if (!previousErrors.has(error.message))
        warnings.push(`Line ${index + 1}: ${error.message}`);
  }
  return [...new Set(warnings)];
}

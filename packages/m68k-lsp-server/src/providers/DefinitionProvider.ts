import * as lsp from "vscode-languageserver";
import type { ParsedLine } from "m68k-parser";
import { type Provider } from ".";
import { type AstNode, nodeAtPosition } from "../ast";
import { type Context } from "../context";
import { isProcessed } from "../DocumentProcessor";
import { locationAsRange } from "../geometry";
import { getDefinitions } from "../symbols";

const registerAssignments = new Set(["lea", "move", "movea", "moveq"]);

export default class DefinitionProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  async onDefinition({
    textDocument,
    position,
  }: lsp.DefinitionParams): Promise<lsp.Location[]> {
    const document = this.ctx.store.get(textDocument.uri);
    if (isProcessed(document)) {
      const path = nodeAtPosition(document.parsed, position);
      const register = path && generalPurposeRegister(path.node);
      if (register) {
        const assignment = precedingRegisterAssignment(
          document.parsed.lines,
          position.line,
          register,
        );
        return assignment
          ? [
              lsp.Location.create(
                textDocument.uri,
                locationAsRange(assignment.loc),
              ),
            ]
          : [];
      }
    }

    const defs = await getDefinitions(textDocument.uri, position, this.ctx);
    return defs.map((d) => d.location);
  }

  register(connection: lsp.Connection) {
    connection.onDefinition(this.onDefinition.bind(this));
    return {
      definitionProvider: true,
    };
  }
}

function precedingRegisterAssignment(
  lines: ParsedLine[],
  currentLine: number,
  register: string,
): AstNode | undefined {
  if (isNonLocalLabel(lines[currentLine])) {
    return;
  }

  for (let index = currentLine - 1; index >= 0; index--) {
    const line = lines[index];
    const mnemonic =
      line.mnemonic?.type === "instruction"
        ? line.mnemonic.instruction.toLowerCase()
        : undefined;
    const destination = line.operands?.at(-1) as AstNode | undefined;
    if (
      mnemonic &&
      registerAssignments.has(mnemonic) &&
      destination &&
      generalPurposeRegister(destination) === register
    ) {
      return destination;
    }
    if (isNonLocalLabel(line)) {
      return;
    }
  }
}

function isNonLocalLabel(line: ParsedLine | undefined): boolean {
  return line?.label !== undefined && line.label.scope !== "local";
}

function generalPurposeRegister(node: AstNode): string | undefined {
  if (node.type !== "data-register" && node.type !== "address-register") {
    return;
  }
  const value = (node as AstNode & { register?: unknown }).register;
  if (typeof value !== "string") {
    return;
  }
  return value.toLowerCase() === "sp" ? "a7" : value.toLowerCase();
}

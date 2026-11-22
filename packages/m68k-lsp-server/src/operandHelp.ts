import type { AddressRegister, DataRegister, OperandNode } from "m68k-parser";
import { Range } from "vscode-languageserver";
import type { Context } from "./context";
import type { ProcessedDocument } from "./DocumentProcessor";
import { componentAtIndex, ComponentType, parseLine } from "./parse";
import { createAliasResolver } from "./registerAnalysis";
import { DefinitionType, resolveDefinitionByName } from "./symbols";

export function instructionAtCursor(
  processed: ProcessedDocument,
  lineNumber: number,
  character: number,
) {
  const text = processed.document
    .getText(Range.create(lineNumber, 0, lineNumber + 1, 0))
    .replace(/\r?\n$/, "");
  const line = parseLine(text);
  let component = componentAtIndex(line, character);
  if (
    !component &&
    line.mnemonic &&
    character > (line.size ?? line.mnemonic).end &&
    (!line.comment || character < line.comment.start)
  ) {
    const previous = (line.operands ?? []).filter(
      (operand) => operand.end < character,
    );
    const last = previous.at(-1);
    if (!last || text.slice(last.end, character).includes(",")) {
      component = {
        type: ComponentType.Operand,
        index: previous.length,
        component: { start: character, end: character, value: "" },
      };
    }
  }
  return { line, component };
}

/** A bare name may be a register alias or a symbol still being typed. */
export function operandsForSignatures(
  ctx: Context,
  processed: ProcessedDocument,
  line: number,
  ignoreOperand?: number,
): (OperandNode | undefined)[] {
  const { uri } = processed;
  const resolveAlias = createAliasResolver(ctx, uri);
  return (processed.parsed.lines[line]?.operands ?? []).map(
    (operand, index) => {
      if (
        index === ignoreOperand ||
        operand.type === "unknown" ||
        operand.type === "macro-parameter" ||
        operand.type === "macro-argument"
      )
        return undefined;
      if (
        operand.type !== "absolute-address" ||
        operand.addressSize ||
        operand.address.type !== "symbol"
      )
        return operand;

      const { name, interpolated } = operand.address;
      if (interpolated) return undefined;
      const definition = resolveDefinitionByName(uri, name, ctx);
      if (!definition) return undefined;
      if (
        definition.type !== DefinitionType.Register &&
        definition.type !== DefinitionType.RegisterList
      )
        return operand;
      const registers = resolveAlias(name);
      if (!registers?.length) return undefined;
      if (definition.type === DefinitionType.RegisterList) {
        return {
          type: "register-list",
          loc: operand.loc,
          raw: [name],
          registers: registers as (AddressRegister | DataRegister)[],
        };
      }
      const register = registers[0];
      return register.startsWith("d")
        ? {
            type: "data-register",
            loc: operand.loc,
            register: register as DataRegister,
          }
        : {
            type: "address-register",
            loc: operand.loc,
            register: register as AddressRegister,
          };
    },
  );
}

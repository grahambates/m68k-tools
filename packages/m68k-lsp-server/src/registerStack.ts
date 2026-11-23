import type { BlockStructure, ParsedFile, ParsedLine } from "m68k-parser";
import type { AstNode } from "./ast";
import {
  type AliasResolver,
  registerName,
  registersAt,
} from "./registerEffects";
import {
  canonicalGeneralPurposeRegister,
  collectMacroDefinitionLines,
  isNonLocalCodeLabel,
} from "./registerSource";

/**
 * Registers code stashes on the stack and restores: a `.l` MOVEM or MOVE of
 * a register to `-(sp)` and back from `(sp)+`. Each restore pairs with the
 * nearest save of the register before it, within the region from one
 * non-local label to the next, so a register can be stashed at several
 * points, and a save can have several restores, as on early exits. A save
 * nothing restores, such as an argument pushed for a call, is not paired.
 */
export interface StackSaves {
  /** The lines restoring a register saved on a line, if it is paired. */
  restoresOf(saveLine: number, register: string): number[] | undefined;
  /** The line that saved a register a line restores, if it is paired. */
  saveOf(restoreLine: number, register: string): number | undefined;
  /**
   * Whether a line lies after a pair's save and up to its last restore, so
   * that what it does to the register is undone.
   */
  covers(line: number, register: string): boolean;
  /** The registers a line saves that are paired, with the lines restoring each. */
  restoresAt(saveLine: number): ReadonlyMap<string, number[]> | undefined;
  /** The registers whose pairs `covers` a line. */
  coveredAt(line: number): string[];
}

export function findStackSaves(
  file: ParsedFile,
  blocks: BlockStructure,
  aliases: AliasResolver,
): StackSaves {
  const { lines } = file;
  const macroDefinitionLines = collectMacroDefinitionLines(blocks.blocks);
  const saves = new Map<string, number[]>();
  const restores = new Map<string, number[]>();
  const regionOf: number[] = [];
  let region = 0;
  for (const [index, line] of lines.entries()) {
    if (macroDefinitionLines.has(index)) {
      regionOf.push(region);
      continue;
    }
    if (isNonLocalCodeLabel(line)) {
      region++;
    }
    regionOf.push(region);
    const transfer = stackTransfer(line, aliases);
    for (const register of transfer?.registers ?? []) {
      const key = `${region}:${register}`;
      const lines = transfer!.kind === "save" ? saves : restores;
      (lines.get(key) ?? lines.set(key, []).get(key)!).push(index);
    }
  }

  const restoresBySave = new Map<number, Map<string, number[]>>();
  const saveByRestore = new Map<number, Map<string, number>>();
  // A pair lies within one region, so a line can only lie within the pairs of
  // its own.
  const spans = new Map<number, Map<string, [number, number][]>>();
  for (const [key, restoreLines] of restores) {
    const saveLines = saves.get(key) ?? [];
    const register = key.slice(key.indexOf(":") + 1);
    for (const restore of restoreLines) {
      const save = saveLines.filter((line) => line < restore).at(-1);
      if (save === undefined) {
        continue;
      }
      const byRegister =
        restoresBySave.get(save) ??
        restoresBySave.set(save, new Map()).get(save)!;
      (
        byRegister.get(register) ?? byRegister.set(register, []).get(register)!
      ).push(restore);
      (
        saveByRestore.get(restore) ??
        saveByRestore.set(restore, new Map()).get(restore)!
      ).set(register, save);
    }
  }
  for (const [save, byRegister] of restoresBySave) {
    const region = regionOf[save];
    const regionSpans =
      spans.get(region) ?? spans.set(region, new Map()).get(region)!;
    for (const [register, restoreLines] of byRegister) {
      (
        regionSpans.get(register) ??
        regionSpans.set(register, []).get(register)!
      ).push([save, Math.max(...restoreLines)]);
    }
  }
  const covers = (line: number, register: string) =>
    (spans.get(regionOf[line])?.get(register) ?? []).some(
      ([save, last]) => save < line && line <= last,
    );
  return {
    restoresOf: (line, register) => restoresBySave.get(line)?.get(register),
    saveOf: (line, register) => saveByRestore.get(line)?.get(register),
    covers,
    restoresAt: (line) => restoresBySave.get(line),
    coveredAt: (line) =>
      [...(spans.get(regionOf[line])?.keys() ?? [])].filter((register) =>
        covers(line, register),
      ),
  };
}

/** Whether a line pushes registers onto the stack or pops them off it. */
function stackTransfer(
  line: ParsedLine,
  aliases: AliasResolver,
): { kind: "save" | "restore"; registers: string[] } | undefined {
  const mnemonic =
    line.mnemonic?.type === "instruction"
      ? line.mnemonic.instruction.toLowerCase()
      : undefined;
  const size =
    line.qualifier?.type === "size" ? line.qualifier.size.toLowerCase() : "";
  const operands = (line.operands ?? []) as AstNode[];
  if (
    (mnemonic !== "movem" && mnemonic !== "move" && mnemonic !== "movea") ||
    size !== "l" ||
    operands.length !== 2 ||
    line.inlineCondition !== undefined
  ) {
    return;
  }
  const stack = (operand: AstNode, type: string) =>
    operand.type === type &&
    canonicalGeneralPurposeRegister(
      registerName((operand as AstNode & { register: AstNode }).register),
    ) === "a7";
  const direct = (operand: AstNode) =>
    registersAt(operand, aliases)
      .filter(({ node }) => node === operand)
      .flatMap(({ registers }) => registers);
  const [source, destination] = operands;
  if (stack(destination, "address-register-indirect-predec")) {
    const registers = direct(source);
    return registers.length ? { kind: "save", registers } : undefined;
  }
  if (stack(source, "address-register-indirect-postinc")) {
    const registers = direct(destination);
    return registers.length ? { kind: "restore", registers } : undefined;
  }
}

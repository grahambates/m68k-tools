import {
  evaluateConstant,
  type ExpressionNode,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import {
  COPPER_DANGER_REGISTER,
  COPPER_SAFE_REGISTER,
  CUSTOM_BASE,
  customRegisterAt,
  customRegisterSymbols,
  decodeCopperInstruction,
  isCopperEnd,
  registerDoc,
  type CopperInstruction,
} from "@m68k-lsp/platforms";
import { describeWrite, hex } from "./amigaHardware";

/** A symbol's value, where the project defines one. */
type Lookup = (name: string) => number | undefined;

const isWordData = (line: ParsedLine) =>
  line.mnemonic?.type === "directive" &&
  line.mnemonic.directive.toLowerCase() === "dc" &&
  (line.qualifier?.type !== "size" ||
    line.qualifier.size.toLowerCase() === "w");

/** The values of a `dc.w` line, read where they can be. */
function words(line: ParsedLine, lookup: Lookup): (number | undefined)[] {
  return (line.operands ?? []).map((operand) => {
    if (operand.type !== "value") return undefined;
    const result = evaluateConstant(operand.value, lookup);
    return result.known ? result.value & 0xffff : undefined;
  });
}

const isRegisterSymbol = (expr: ExpressionNode | undefined) =>
  expr?.type === "symbol" && customRegisterSymbols.has(expr.name.toLowerCase());

/**
 * Whether the `dc.w` line at `index` is in a Copper list: a run of `dc.w`
 * lines, with labels and comments among them, that has a MOVE to a register
 * named as the includes name it, the usual end, $FFFF,$FFFE, or a label with
 * "cop" in its name. A pair of numbers alone could be any data.
 */
export function inCopperList(
  parsed: ParsedFile,
  index: number,
  lookup: Lookup,
): boolean {
  const { lines } = parsed;
  if (!lines[index] || !isWordData(lines[index])) return false;
  const inRun = (line: ParsedLine) => !line.mnemonic || isWordData(line);
  let start = index;
  while (start > 0 && inRun(lines[start - 1])) start--;
  let end = index;
  while (end < lines.length - 1 && inRun(lines[end + 1])) end++;
  // A label just above the run names it.
  const above = lines[start - 1];
  const labels = [above, ...lines.slice(start, end + 1)].flatMap((line) =>
    line?.label ? [line.label.label] : [],
  );
  if (labels.some((name) => /cop/i.test(name))) return true;

  for (const line of lines.slice(start, end + 1)) {
    if (!isWordData(line)) continue;
    const operands = line.operands ?? [];
    const values = words(line, lookup);
    for (let i = 0; i + 1 < operands.length; i += 2) {
      const first = operands[i];
      if (first.type === "value" && isRegisterSymbol(first.value)) return true;
      if (values[i] === 0xffff && values[i + 1] === 0xfffe) return true;
    }
  }
  return false;
}

/**
 * What the Copper instruction a `dc.w` operand belongs to does, in a Copper
 * list: a WAIT, a SKIP, or a MOVE written as numbers, `dc.w $0180,$0f80`. A
 * MOVE to a register named by its symbol is read as a register write
 * elsewhere.
 */
export function copperDocs(
  parsed: ParsedFile,
  index: number,
  operand: number,
  lookup: Lookup,
): string | undefined {
  const line = parsed.lines[index];
  if (!line || !isWordData(line)) return;
  const pair = operand - (operand % 2);
  const operands = line.operands ?? [];
  const first = operands[pair];
  if (!first || !operands[pair + 1]) return;
  if (first.type === "value" && isRegisterSymbol(first.value)) return;
  const [ir1, ir2] = words(line, lookup).slice(pair, pair + 2);
  if (ir1 === undefined || ir2 === undefined) return;
  if (!inCopperList(parsed, index, lookup)) return;
  return describeInstruction(decodeCopperInstruction(ir1, ir2));
}

const line = (vertical: number) => `line ${hex(vertical, 2)} (${vertical})`;

function describeInstruction(instruction: CopperInstruction): string {
  if (instruction.kind === "move") {
    const { register: offset, value } = instruction;
    const register = customRegisterAt(CUSTOM_BASE + offset);
    const name = register?.name ?? hex(offset, 3);
    const parts = [`Copper **MOVE** to **${name}** (${hex(offset, 3)})`];
    if (offset < COPPER_DANGER_REGISTER)
      parts.push("The Copper cannot write registers below $10.");
    else if (offset < COPPER_SAFE_REGISTER)
      parts.push(
        "Only with COPCON's danger bit set can the Copper write this.",
      );
    const doc = register && registerDoc(register.name);
    const decoded = doc && describeWrite(register.name, doc, value);
    return [parts.join(". "), decoded].filter(Boolean).join("  \n");
  }

  if (isCopperEnd(instruction))
    return "Copper **WAIT** for a position that never comes: the end of the Copper list, until the next frame.";

  const { vertical, horizontal, verticalMask, horizontalMask } = instruction;
  const where =
    horizontalMask === 0
      ? `${line(vertical)}, any horizontal position`
      : `${line(vertical)}, horizontal ${hex(horizontal, 2)}`;
  const masks = [
    verticalMask !== 0xff ? `vertical bits ${hex(verticalMask, 2)}` : "",
    horizontalMask !== 0 && horizontalMask !== 0xfe
      ? `horizontal bits ${hex(horizontalMask, 2)}`
      : "",
  ].filter(Boolean);
  const comparing = masks.length ? `, comparing ${masks.join(" and ")}` : "";
  const blitter = instruction.waitsForBlitter
    ? ", and for the blitter to finish"
    : "";
  return instruction.kind === "wait"
    ? `Copper **WAIT** for ${where}${comparing}${blitter}`
    : `Copper **SKIP** the next instruction once at ${where}${comparing}${blitter}`;
}

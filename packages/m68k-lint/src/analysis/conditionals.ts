import {
  collectMacroDefinitions,
  parseBlocks,
  type ExpressionNode,
  type OperandNode,
  type ParsedFile,
} from "m68k-parser";
import { scanBlocks, type ConditionalBlock } from "./blocks.js";
import { constantDefinition } from "./symbols.js";

/**
 * Which lines conditional assembly leaves out.
 *
 * Only the arm an assembler would take is assembled, so code in the others is
 * not part of the program and must not take part in flow, in register values or
 * in the constants the file defines. Without this every arm was treated as a
 * possible alternative, so a constant defined one way in an IF arm and another
 * in its ELSE arm was a "conflict" even when the condition was fixed.
 *
 * Deliberately limited to conditions the file itself can settle: an expression
 * that evaluates from literals and known constants, or a symbol the file
 * defines earlier. Anything else -- a name defined elsewhere, or by an option on
 * the assembler's command line, a string comparison, the pass number -- leaves
 * the block undecided, and undecided blocks are treated exactly as before, as
 * alternatives that may each be assembled.
 */
export interface ConditionalAssembly {
  /** The line sits in an arm that is not assembled. */
  readonly unassembled: readonly boolean[];
  /**
   * The line is an IF, ELSE, ELSEIF or ENDC of a block whose outcome is known.
   * Such a block is not a choice: control simply runs through the arm taken.
   */
  readonly decided: readonly boolean[];
}

const NOTHING: ConditionalAssembly = { unassembled: [], decided: [] };
const settled = new WeakMap<ParsedFile, ConditionalAssembly>();

/** What conditional assembly leaves out of a file, once `prepareConditionals` has run. */
export function conditionalAssembly(file: ParsedFile): ConditionalAssembly {
  return settled.get(file) ?? NOTHING;
}

export type Arm = "yes" | "no" | "maybe";

/** Compare an expression's value to zero as each IF form does. */
const COMPARISONS: Record<string, (value: number) => boolean> = {
  if: (v) => v !== 0,
  ifne: (v) => v !== 0,
  ifeq: (v) => v === 0,
  ifgt: (v) => v > 0,
  ifge: (v) => v >= 0,
  iflt: (v) => v < 0,
  ifle: (v) => v <= 0,
  elseif: (v) => v !== 0,
};

/**
 * Whether a condition holds, for the forms that depend only on an expression's
 * value or on whether an argument was given. Undefined for any other directive.
 */
export function evaluateCondition(
  directive: string,
  operands: readonly OperandNode[] | undefined,
  evaluate: (expr: ExpressionNode) => number | undefined,
): Arm | undefined {
  // IFB and IFNB ask whether an argument is blank, which is only meaningful
  // once a macro's arguments have been substituted in.
  if (directive === "ifb") return operands?.length ? "no" : "yes";
  if (directive === "ifnb") return operands?.length ? "yes" : "no";

  const compare = COMPARISONS[directive];
  if (!compare) return undefined;
  const first = operands?.[0];
  const expression =
    first?.type === "value"
      ? first.value
      : first?.type === "absolute-address"
        ? first.address
        : undefined;
  const value = expression ? evaluate(expression) : undefined;
  if (value === undefined) return "maybe";
  return compare(value) ? "yes" : "no";
}

/**
 * Work out which arms of each conditional block are assembled.
 *
 * @param evaluate the value of an expression, when it is known
 * @returns whether anything was left out, so a caller can redo what depended
 *   on those lines
 */
export function prepareConditionals(
  file: ParsedFile,
  evaluate: (expr: ExpressionNode) => number | undefined,
): boolean {
  const regions = scanBlocks(file);
  const unassembled = new Array<boolean>(file.lines.length).fill(false);
  const decided = new Array<boolean>(file.lines.length).fill(false);

  // Names the file defines, and where, for IFD and IFMACROD.
  const symbols = new Map<string, number>();
  file.lines.forEach((line, index) => {
    if (regions.region[index] !== 0) return;
    for (const name of [line.label?.label, constantDefinition(line)?.name] as (
      string | undefined
    )[])
      if (name && !symbols.has(name.toLowerCase()))
        symbols.set(name.toLowerCase(), index);
  });
  const macros = new Map<string, number>();
  for (const macro of collectMacroDefinitions(file, [], parseBlocks(file)))
    if (!macros.has(macro.name.toLowerCase()))
      macros.set(macro.name.toLowerCase(), macro.start);

  const directive = (index: number) =>
    file.lines[index].mnemonic?.type === "directive"
      ? file.lines[index].mnemonic.directive.toLowerCase()
      : undefined;

  const condition = (index: number): Arm => {
    const name = directive(index);
    if (name === "else") return "yes";
    if (!name) return "maybe";
    const first = file.lines[index].operands?.[0];

    const decided = evaluateCondition(name, first ? [first] : [], evaluate);
    if (decided && name !== "ifb" && name !== "ifnb") return decided;

    // Defined earlier in this file is a fact; not defined is not, since the
    // assembler may have been given the name on its command line.
    const symbolName =
      first?.type === "value" && first.value.type === "symbol"
        ? first.value.name.toLowerCase()
        : undefined;
    if (!symbolName) return "maybe";
    if (name === "ifd" || name === "ifnd") {
      const at = symbols.get(symbolName);
      if (at === undefined || at >= index) return "maybe";
      return name === "ifd" ? "yes" : "no";
    }
    if (name === "ifmacrod" || name === "ifmacrond") {
      const at = macros.get(symbolName);
      if (at === undefined || at >= index) return "maybe";
      return name === "ifmacrod" ? "yes" : "no";
    }
    return "maybe";
  };

  let changed = false;
  const blocks: ConditionalBlock[] = regions.conditionals;
  for (const block of blocks) {
    // A macro body is not assembled where it is written.
    if (regions.region[block.start] !== 0) continue;

    const starts = [block.start, ...block.alternatives];
    const arms: Arm[] = [];
    let taken = false;
    let uncertain = false;
    for (const start of starts) {
      const wanted = taken ? "no" : condition(start);
      // An arm whose condition holds is assembled if control gets to it, and
      // either way nothing after it can be: if an earlier arm was taken this
      // one is skipped, and if not this one is.
      arms.push(wanted === "yes" && uncertain ? "maybe" : wanted);
      if (wanted === "yes") taken = true;
      if (wanted === "maybe") uncertain = true;
    }

    if (arms.every((arm) => arm !== "maybe")) {
      for (const at of [...starts, block.end]) decided[at] = true;
    }
    arms.forEach((arm, k) => {
      if (arm !== "no") return;
      const end = (starts[k + 1] ?? block.end) - 1;
      for (let i = starts[k] + 1; i <= end; i++) {
        unassembled[i] = true;
        changed = true;
      }
    });
  }

  settled.set(file, { unassembled, decided });
  return changed;
}

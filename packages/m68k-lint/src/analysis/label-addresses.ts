import type { ExpressionNode, ParsedLine } from "m68k-parser";
import type { RuleContext } from "../core/context.js";
import {
  getRegisterSemantics,
  normalizeRegister,
  type Register,
} from "../semantics/registers.js";
import { semanticMnemonic } from "../semantics/mnemonics.js";
import { instructionSize, operand } from "../util/ast.js";

/**
 * The label an address expression points at: the label alone, or offset by a
 * constant. Anything else, such as the difference of two labels, is not an
 * address within one label's section.
 */
export function targetLabel(
  ctx: RuleContext,
  expr: ExpressionNode,
): string | undefined {
  switch (expr.type) {
    case "symbol":
      return expr.name;
    case "group":
      return targetLabel(ctx, expr.expression);
    case "binary-op": {
      if (expr.operator !== "+" && expr.operator !== "-") return undefined;
      const left = targetLabel(ctx, expr.left);
      if (left !== undefined && ctx.evaluate(expr.right).known) return left;
      if (expr.operator === "+" && ctx.evaluate(expr.left).known)
        return targetLabel(ctx, expr.right);
      return undefined;
    }
    default:
      return undefined;
  }
}

/** A label whose address an instruction loads into a register. */
export interface LabelLoad {
  name: string;
  /** The line that loads it. */
  index: number;
}

type Definition =
  | { kind: "label"; name: string }
  | { kind: "copy"; from: Register }
  | { kind: "other" };

/**
 * What a write to `register` on this line puts there: a label's address, a
 * copy of another register, or something this does not follow.
 */
function definitionOf(
  ctx: RuleContext,
  line: ParsedLine,
  register: Register,
): Definition {
  const mnemonic = semanticMnemonic(line);
  const source = operand(line, 0);
  const dest = operand(line, 1);
  const writesHere =
    (dest?.type === "address-register" || dest?.type === "data-register") &&
    normalizeRegister(dest.register) === register;
  if (!writesHere || !source) return { kind: "other" };

  const label = (expr: ExpressionNode): Definition => {
    const name = targetLabel(ctx, expr);
    return name === undefined ? { kind: "other" } : { kind: "label", name };
  };

  if (mnemonic === "lea") {
    if (source.type === "absolute-address") return label(source.address);
    if (source.type === "pc-relative") return label(source.displacement);
    return { kind: "other" };
  }
  // Only a long move sets all 32 bits; MOVEA.W sign-extends a word, which is
  // not how a label's address is loaded.
  if (
    (mnemonic === "move" || mnemonic === "movea") &&
    instructionSize(line) === "l"
  ) {
    if (source.type === "immediate") return label(source.value);
    if (source.type === "address-register" || source.type === "data-register") {
      const from = normalizeRegister(source.register);
      if (from) return { kind: "copy", from };
    }
  }
  return { kind: "other" };
}

/**
 * The label addresses that can be in `register` when line `index` runs.
 *
 * Walks back through the control-flow graph to each write that reaches the
 * line, following register-to-register copies. Only the loads it can see are
 * returned: a path that reaches a call, a macro it cannot see into, the start
 * of the flow or any other kind of write gives no answer and is dropped, so
 * an empty result means nothing is known, not that nothing is there.
 */
export function labelLoadsReaching(
  ctx: RuleContext,
  index: number,
  register: Register,
): LabelLoad[] {
  const { predecessors } = ctx.registers.cfg;
  const loads = new Map<number, LabelLoad>();
  const seen = new Set<string>();
  const work: { at: number; register: Register }[] = [{ at: index, register }];

  while (work.length) {
    const { at, register } = work.pop()!;
    for (const from of predecessors[at] ?? []) {
      const state = `${from}:${register}`;
      if (seen.has(state)) continue;
      seen.add(state);

      const line = ctx.line(from);
      if (!line) continue;
      const semantics = getRegisterSemantics(line);
      if (semantics.unknownEffects || semantics.call) continue;
      if (!semantics.writes.has(register)) {
        work.push({ at: from, register });
        continue;
      }
      // A write that may not happen, such as a word write or a line made
      // conditional by IIF, leaves part of what came before.
      if (semantics.partialWrites.has(register)) continue;

      const definition = definitionOf(ctx, line, register);
      if (definition.kind === "label")
        loads.set(from, { name: definition.name, index: from });
      else if (definition.kind === "copy")
        work.push({ at: from, register: definition.from });
    }
  }
  return [...loads.values()];
}

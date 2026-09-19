import type { ExpressionNode, ParsedFile, ParsedLine } from "m68k-parser";
import { isReturn } from "../semantics/flags.js";
import { semanticMnemonic } from "../semantics/mnemonics.js";
import {
  getRegisterSemantics,
  isStackPointerRegister,
} from "../semantics/registers.js";
import {
  immediateExpressionOperand,
  instructionSize,
  isExecutableLine,
  isMacroInvocation,
} from "../util/ast.js";
import { buildControlFlowGraph } from "./cfg.js";
import { stackSave } from "./register-saves.js";
import { expansionOf } from "../semantics/macro-expansions.js";

/**
 * How far the stack pointer has moved from where the routine found it, in bytes
 * pushed. A push adds to it and a pop takes away, so a balanced routine is back
 * at zero when it returns.
 */
interface State {
  depth: number;
  /** Depth just after a LINK pushed the frame pointer, for UNLK to return to. */
  frame?: number;
}

export type StackFinding =
  | { kind: "leftover"; index: number; depth: number }
  | { kind: "conflict"; index: number; depths: [number, number] };

function isStackPointer(op: unknown): boolean {
  const node = op as { type?: string; register?: unknown } | undefined;
  if (!node) return false;
  if (node.type === "address-register")
    return isStackPointerRegister(String(node.register));
  const base = node.register as
    { type?: string; register?: string } | undefined;
  return (
    base?.type === "address-register" &&
    isStackPointerRegister(base.register ?? "")
  );
}

function pushBytes(size: string | undefined): number | undefined {
  // A byte push moves the stack pointer by two, keeping it even.
  if (size === "b" || size === "w") return 2;
  if (size === "l") return 4;
  return undefined;
}

/**
 * The state after a line, or undefined when its effect on the stack cannot be
 * followed. Unknown is the safe answer: everything downstream goes quiet.
 */
function transfer(
  line: ParsedLine,
  state: State,
  evaluate: (expr: ExpressionNode) => number | undefined,
): State | undefined {
  const save = stackSave(line);
  if (save)
    return {
      ...state,
      depth:
        state.depth +
        (save.kind === "push" ? 1 : -1) *
          save.registers.length *
          save.bytesEach,
    };
  const expansion = expansionOf(line);
  if (expansion) {
    let current: State | undefined = state;
    for (const step of expansion) {
      current = current && transfer(step, current, evaluate);
      if (!current) return undefined;
    }
    return current;
  }
  if (isMacroInvocation(line)) return undefined;
  const mnemonic = semanticMnemonic(line);
  if (!mnemonic) return undefined;
  const size = instructionSize(line);
  const operands = line.operands ?? [];

  if (mnemonic === "link") {
    const disp = immediateExpressionOperand(line, 1);
    const value = disp ? evaluate(disp) : undefined;
    if (value === undefined) return undefined;
    const frame = state.depth + 4;
    return { depth: frame - value, frame };
  }
  if (mnemonic === "unlk") {
    if (state.frame === undefined) return undefined;
    return { depth: state.frame - 4 };
  }
  if (mnemonic === "pea") return { ...state, depth: state.depth + 4 };

  // Adjustments of the stack pointer itself.
  if (isStackPointer(operands[1]) && operands[1].type === "address-register") {
    const amount = (() => {
      if (["add", "adda", "addq", "sub", "suba", "subq"].includes(mnemonic)) {
        const imm = immediateExpressionOperand(line, 0);
        const value = imm ? evaluate(imm) : undefined;
        if (value === undefined) return undefined;
        return mnemonic.startsWith("add") ? -value : value;
      }
      if (mnemonic === "lea") {
        const source = operands[0];
        if (
          source?.type === "address-register-indirect-displacement" &&
          isStackPointer(source)
        ) {
          const value = evaluate(source.displacement);
          return value === undefined ? undefined : -value;
        }
        if (
          source?.type === "address-register-indirect" &&
          isStackPointer(source)
        )
          return 0;
      }
      return undefined;
    })();
    if (amount === undefined) return undefined;
    return { ...state, depth: state.depth + amount };
  }

  // Ordinary pushes and pops through -(sp) and (sp)+.
  let depth = state.depth;
  for (const op of operands) {
    if (
      op.type !== "address-register-indirect-predec" &&
      op.type !== "address-register-indirect-postinc"
    )
      continue;
    if (!isStackPointer(op)) continue;
    const bytes = pushBytes(size);
    if (bytes === undefined) return undefined;
    depth += op.type === "address-register-indirect-predec" ? bytes : -bytes;
  }

  // Anything else that writes the stack pointer is beyond what is followed.
  const semantics = getRegisterSemantics(line);
  const changedElsewhere =
    (semantics.writes.has("a7") || semantics.partialWrites.has("a7")) &&
    depth === state.depth;
  if (changedElsewhere) return undefined;

  return { ...state, depth };
}

/**
 * Follow the stack depth through each routine.
 *
 * A routine starts at every global label with nothing pushed. Its depth is
 * carried along the control-flow graph through pushes, pops, stack adjustments
 * and LINK/UNLK. Calls and traps are taken to leave it as it was. Two things
 * are reported: a return reached with more pushed than popped, and a line
 * reached by paths that disagree about the depth.
 *
 * The depth goes unknown at anything it cannot follow -- a macro, a write to
 * the stack pointer it does not model -- and stays unknown, so a finding is
 * always about code the analysis could follow the whole way.
 */
export function findStackImbalances(
  file: ParsedFile,
  evaluate: (expr: ExpressionNode) => number | undefined,
): StackFinding[] {
  const cfg = buildControlFlowGraph(file);
  const count = file.lines.length;

  const seeds = new Set<number>();
  let seedNext = true;
  file.lines.forEach((line, index) => {
    if (line.label?.scope === "global") seedNext = true;
    if (!isExecutableLine(line)) return;
    if (seedNext) seeds.add(index);
    seedNext = false;
  });

  type Slot = State | "unknown" | undefined;
  const before: Slot[] = new Array<Slot>(count).fill(undefined);
  const after: Slot[] = new Array<Slot>(count).fill(undefined);
  const conflicts = new Map<number, [number, number]>();

  const same = (a: Slot, b: Slot) =>
    a === b ||
    (typeof a === "object" &&
      typeof b === "object" &&
      a.depth === b.depth &&
      a.frame === b.frame);

  const work: number[] = [...seeds];
  for (const seed of seeds) before[seed] = { depth: 0 };

  while (work.length) {
    const index = work.pop()!;
    const line = file.lines[index];
    const input = before[index];
    if (input === undefined) continue;

    let output: Slot;
    if (input === "unknown") output = "unknown";
    else output = transfer(line, input, evaluate) ?? "unknown";
    if (same(after[index], output)) continue;
    after[index] = output;

    for (const next of cfg.successors[index]) {
      if (seeds.has(next)) continue;
      const current = before[next];
      let merged: Slot;
      if (current === undefined) merged = output;
      else if (current === "unknown" || output === "unknown")
        merged = "unknown";
      else if (same(current, output)) merged = current;
      else {
        conflicts.set(next, [current.depth, output.depth]);
        merged = "unknown";
      }
      if (same(current, merged)) continue;
      before[next] = merged;
      work.push(next);
    }
  }

  const findings: StackFinding[] = [];
  for (const [index, depths] of conflicts)
    findings.push({ kind: "conflict", index, depths });
  file.lines.forEach((line, index) => {
    const state = before[index];
    if (typeof state !== "object" || state.depth <= 0) return;
    if (line.mnemonic?.type === "instruction" && isReturn(line))
      findings.push({ kind: "leftover", index, depth: state.depth });
  });
  findings.sort((a, b) => a.index - b.index);
  return findings;
}

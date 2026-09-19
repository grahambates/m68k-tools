import { descendants, type OperandNode, type ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { stackSave } from "../../analysis/register-saves.js";
import { getFlagSemantics } from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import {
  getRegisterSemantics,
  isStackPointerRegister,
  type Register,
} from "../../semantics/registers.js";
import { isOpaqueMacro } from "../../util/ast.js";
import { expansionOf } from "../../semantics/macro-expansions.js";
import { formatRegisterList } from "../suspicious/movem-restore-mismatch.js";

/** Whether an operand mentions the stack pointer, reading the slots the save made. */
function mentionsStackPointer(operand: OperandNode): boolean {
  return [operand, ...descendants(operand)].some(
    (node) =>
      node.type === "address-register" &&
      isStackPointerRegister(String((node as { register?: unknown }).register)),
  );
}

function usesStackByOffset(line: ParsedLine): boolean {
  return (line.operands ?? []).some(
    (op) =>
      op.type !== "address-register-indirect-predec" &&
      op.type !== "address-register-indirect-postinc" &&
      mentionsStackPointer(op),
  );
}

const sameRegisters = (a: readonly Register[], b: readonly Register[]) =>
  a.length === b.length && a.every((register, i) => register === b[i]);

/**
 * A register saved on entry and restored on exit that the code in between
 * never changes.
 *
 * The save and restore cost a memory transfer each way for every register in
 * the list, and buy nothing when the value could not have been altered. Lists
 * tend to grow to cover a whole routine and are never trimmed back as the
 * routine is edited.
 *
 * Deliberately narrow, because the saved registers protect more than the
 * routine's own writes:
 *
 * - A call, trap, macro or jump the analysis cannot follow makes the body
 *   opaque. Whatever it reaches may change the register, and the save is what
 *   keeps that from the caller.
 * - Anything addressing the stack by offset or through the pointer itself
 *   reads the slots the save made. Trimming the list moves every offset, so
 *   those are left alone.
 * - Every path from the save must reach a restore of the same list. A return
 *   without one, or a path leaving through an unknown jump, means the pairing
 *   is not what it looks like.
 *
 * `PUSHM` and `POPM` are read as `movem.l` to and from the stack.
 */
export const unneededRegisterSave: Rule = {
  meta: {
    id: "optimization/unneeded-register-save",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Flag a saved and restored register that the routine never changes",
    tags: ["movem", "stack", "registers", "pushm"],
    docs: {
      note: "Follows every path from a register save (`movem` to the stack, or `PUSHM`) to the matching restore. Only leaf code is examined: a call, trap, macro or unknown jump in between could change the register, and a save that keeps that from the caller is doing its job. Left alone where anything reads the stack by offset, since removing a register moves the offsets. Reported on the save, with the list to use instead.",
    },
  },

  checkFile(ctx) {
    const { cfg } = ctx.registers;

    ctx.file.lines.forEach((line, index) => {
      const save = stackSave(line);
      if (save?.kind !== "push" || save.registers.length === 0) return;

      const modified = new Set<Register>();
      const restores: number[] = [];
      const visited = new Set<number>([index]);
      const pending = [...cfg.successors[index]];
      let followable = true;

      while (pending.length && followable) {
        const at = pending.pop()!;
        if (visited.has(at)) continue;
        visited.add(at);
        const current = ctx.file.lines[at];
        const found = stackSave(current);

        if (
          found?.kind === "pop" &&
          found.bytesEach === save.bytesEach &&
          sameRegisters(found.registers, save.registers)
        ) {
          restores.push(at);
          continue;
        }
        // A way out that is not a matching restore.
        if (cfg.escapes[at]) {
          followable = false;
          break;
        }

        if (found) {
          // Another save is harmless. Another restore writes its registers.
          if (found.kind === "pop")
            for (const register of found.registers) modified.add(register);
        } else if (isOpaqueMacro(current)) {
          followable = false;
          break;
        } else {
          const mnemonic = semanticMnemonic(current) ?? "";
          const semantics = getRegisterSemantics(current);
          const control = getFlagSemantics(current).controlFlow;
          if (
            semantics.unknownEffects ||
            semantics.call ||
            control === "call" ||
            control === "dynamic-jump" ||
            mnemonic.startsWith("trap") ||
            mnemonic === "illegal" ||
            (expansionOf(current) ?? [current]).some(
              (step) =>
                usesStackByOffset(step) ||
                ["link", "unlk"].includes(semanticMnemonic(step) ?? ""),
            )
          ) {
            followable = false;
            break;
          }
          for (const register of semantics.writes) modified.add(register);
          for (const register of semantics.partialWrites)
            modified.add(register);
        }

        for (const next of cfg.successors[at]) pending.push(next);
      }
      if (!followable || restores.length === 0) return;

      const unneeded = save.registers.filter((r) => !modified.has(r));
      if (unneeded.length === 0) return;
      const kept = save.registers.filter((r) => modified.has(r));
      const names = formatRegisterList(unneeded).toUpperCase();
      const restoreLines = restores
        .map((r) => ctx.line(r)?.lineNumber ?? r + 1)
        .sort((a, b) => a - b);
      const mnemonic = line.mnemonic;
      if (!mnemonic) return;

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "high",
        message: `${names} ${unneeded.length === 1 ? "is" : "are"} saved and restored but never changed in between`,
        loc: mnemonic.loc,
        notes: [
          {
            message: `Each register saved costs a memory write on entry and a read on exit. The matching restore is on line ${restoreLines.join(", ")}.`,
          },
        ],
        suggestion: {
          description:
            kept.length === 0
              ? "Remove the save and its restore"
              : `Save only ${formatRegisterList(kept).toUpperCase()}, in the save and every matching restore`,
          applicability: "manual",
        },
        data: { unneeded, kept, restores },
      });
    });
  },
};

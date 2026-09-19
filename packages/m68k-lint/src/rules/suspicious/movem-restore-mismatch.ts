import type { ParsedLine, Size } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { instructionSize, operand } from "../../util/ast.js";
import { isReturn } from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import {
  ADDRESS_REGISTERS,
  DATA_REGISTERS,
  normalizeRegister,
  REGISTERS,
} from "../../semantics/registers.js";
import { stackSave } from "../../analysis/register-saves.js";

/** Collapse a register set back into the `d0-d3/a0/a6` spelling a reader expects. */
export function formatRegisterList(registers: readonly string[]): string {
  const present = new Set(registers);
  const groups: string[] = [];
  for (const bank of [
    DATA_REGISTERS,
    ADDRESS_REGISTERS,
  ] as readonly (readonly string[])[]) {
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      groups.push(
        run.length > 2 ? `${run[0]}-${run[run.length - 1]}` : run.join("/"),
      );
      run = [];
    };
    for (const register of bank) {
      if (present.has(register)) run.push(register);
      else flush();
    }
    flush();
  }
  return groups.join("/");
}

/** A register's canonical name; `sp` is `a7`. Anything else is kept as written. */
function normalize(register: string): string {
  return normalizeRegister(register) ?? register.toLowerCase();
}

function registerOperand(
  line: ParsedLine,
  index: number,
): string[] | undefined {
  const op = operand(line, index);
  if (op?.type === "register-list") return op.registers.map(normalize);
  if (op?.type === "data-register" || op?.type === "address-register")
    return [normalize(op.register)];
  return undefined;
}

function stackRegister(
  line: ParsedLine,
  index: number,
  kind: "predec" | "postinc",
): string | undefined {
  const op = operand(line, index);
  const wanted =
    kind === "predec"
      ? "address-register-indirect-predec"
      : "address-register-indirect-postinc";
  if (op?.type !== wanted) return undefined;
  return op.register.type === "address-register"
    ? normalize(op.register.register)
    : undefined;
}

interface Pending {
  index: number;
  size: Size | undefined;
  registers: string[];
}

function sameRegisters(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((register) => set.has(register));
}

function missingFrom(from: readonly string[], to: readonly string[]): string[] {
  const set = new Set(to);
  return REGISTERS.filter(
    (register) => from.includes(register) && !set.has(register),
  );
}

export const movemRestoreMismatch: Rule = {
  meta: {
    id: "suspicious/movem-restore-mismatch",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a MOVEM restore whose register list does not match the matching save",
    tags: ["movem", "stack", "registers", "likely-typo"],
    docs: {
      note: "Saving and restoring different register lists either unbalances the stack, when the counts differ, or silently restores the wrong registers when they do not. The two lists are edited separately and drift apart easily.",
    },
  },

  checkFile(ctx) {
    // One pending stack per base register, so a routine using its own stack in
    // another address register is handled alongside A7.
    const pending = new Map<string, Pending[]>();

    ctx.file.lines.forEach((line, index) => {
      // PUSHM and POPM are a save and restore through the stack like MOVEM.
      const macro =
        line.mnemonic?.type === "macro" ? stackSave(line) : undefined;
      if (line.mnemonic?.type !== "instruction" && !macro) return;
      const mnemonic = macro ? "movem" : semanticMnemonic(line);
      if (!mnemonic) return;

      // A return ends the routine's stack discipline. Anything still pending
      // belonged to a path we cannot follow, and keeping it would let one
      // routine's leftovers be blamed on the next.
      if (isReturn(line)) {
        pending.clear();
        return;
      }
      if (mnemonic !== "movem") return;

      const size: Size | undefined = macro
        ? macro.bytesEach === 4
          ? "l"
          : "w"
        : instructionSize(line);

      const savedTo = macro
        ? macro.kind === "push"
          ? "a7"
          : undefined
        : stackRegister(line, 1, "predec");
      if (savedTo) {
        const registers = macro ? macro.registers : registerOperand(line, 0);
        if (registers) {
          const stack = pending.get(savedTo) ?? [];
          stack.push({ index, size, registers });
          pending.set(savedTo, stack);
        }
        return;
      }

      const restoredFrom = macro
        ? macro.kind === "pop"
          ? "a7"
          : undefined
        : stackRegister(line, 0, "postinc");
      if (!restoredFrom) return;
      const restored = macro ? macro.registers : registerOperand(line, 1);
      if (!restored) return;

      const stack = pending.get(restoredFrom);
      // Nothing to compare against: the save is on a path we did not see, which
      // is normal for a routine with more than one exit.
      if (!stack?.length) return;

      const top = stack[stack.length - 1];
      if (sameRegisters(top.registers, restored) && top.size === size) {
        stack.pop();
        return;
      }
      // A deeper match means the lists are nested in a way this linear scan
      // cannot pair up. Staying quiet beats guessing.
      if (
        stack.some(
          (entry) =>
            sameRegisters(entry.registers, restored) && entry.size === size,
        )
      )
        return;

      stack.pop();
      const saved = top.registers;
      const notRestored = missingFrom(saved, restored);
      const notSaved = missingFrom(restored, saved);
      const detail: string[] = [];
      if (notRestored.length)
        detail.push(
          `${formatRegisterList(notRestored)} saved but not restored`,
        );
      if (notSaved.length)
        detail.push(`${formatRegisterList(notSaved)} restored but not saved`);
      if (!detail.length && top.size !== size) {
        detail.push(
          `saved as .${top.size ?? "?"} but restored as .${size ?? "?"}`,
        );
      }

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence:
          saved.length === restored.length && top.size === size
            ? "high"
            : "certain",
        message: `MOVEM saves ${formatRegisterList(saved)} but restores ${formatRegisterList(restored)}: ${detail.join(", ")}`,
        loc: line.mnemonic!.loc,
        notes: [
          saved.length !== restored.length || top.size !== size
            ? {
                message:
                  "The two lists move different numbers of bytes, so the stack pointer is left unbalanced.",
              }
            : {
                message:
                  "The lists are the same length, so the stack stays balanced but registers take each other's values.",
              },
          {
            message: `The matching save is on line ${(ctx.line(top.index)?.lineNumber ?? top.index + 1).toString()}.`,
          },
        ],
        suggestion: {
          description:
            "Make the restore list match the save, or the save match the restore",
          applicability: "manual",
        },
        data: {
          saved: formatRegisterList(saved),
          restored: formatRegisterList(restored),
          saveIndex: top.index,
        },
      });
    });
  },
};

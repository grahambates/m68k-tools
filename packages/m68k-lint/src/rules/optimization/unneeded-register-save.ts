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
import {
  moveBeatsSingleRegisterMovem,
  singleRegisterMoveSafety,
} from "./single-register-movem.js";

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
 * A save or restore of one register written as MOVE, keeping the line's
 * spelling: the mnemonic's case, the size as written, the space before the
 * operands and the stack operand as written. `PUSHM d2` becomes
 * `move.l d2,-(sp)`.
 */
function asSingleMove(
  line: ParsedLine,
  sourceLine: string,
  kind: "push" | "pop",
  register: Register,
): string | undefined {
  const mnemonic = line.mnemonic;
  const operands = line.operands ?? [];
  if (!mnemonic || !operands.length) return undefined;
  const text = (loc: { start: number; end: number }) =>
    sourceLine.slice(loc.start, loc.end);
  const written = text(mnemonic.loc);
  const upper = written === written.toUpperCase();
  const macro = mnemonic.type === "macro";
  const size = macro
    ? upper
      ? ".L"
      : ".l"
    : line.qualifier
      ? sourceLine.slice(mnemonic.loc.end, line.qualifier.loc.end)
      : undefined;
  if (!size) return undefined;
  const gap = sourceLine.slice(
    (line.qualifier ?? mnemonic).loc.end,
    operands[0].loc.start,
  );
  const stack = macro
    ? kind === "push"
      ? "-(sp)"
      : "(sp)+"
    : text(operands[kind === "push" ? 1 : 0].loc);
  const listText = text(operands[macro || kind === "push" ? 0 : 1].loc);
  const name =
    listText === listText.toUpperCase() ? register.toUpperCase() : register;
  // A macro names no stack operand; it takes the case of the registers.
  const stackText =
    macro && listText === listText.toUpperCase() ? stack.toUpperCase() : stack;
  return `${upper ? "MOVE" : "move"}${size}${gap || " "}${
    kind === "push" ? `${name},${stackText}` : `${stackText},${name}`
  }`;
}

/**
 * A save or restore with its register list replaced, from the mnemonic to the
 * last operand as written, so the size and spacing stay as they were. The
 * list keeps the letter case of the one it replaces. Undefined where the line
 * names no list to rewrite, as with a bare `POPM`.
 */
function withRegisterList(
  line: ParsedLine,
  sourceLine: string,
  kind: "push" | "pop",
  registers: readonly Register[],
): string | undefined {
  const operands = line.operands ?? [];
  const list =
    line.mnemonic?.type === "macro"
      ? operands[0]
      : operands[kind === "push" ? 0 : 1];
  const last = operands.at(-1);
  if (!line.mnemonic || !list || !last) return undefined;
  const written = sourceLine.slice(list.loc.start, list.loc.end);
  const formatted = formatRegisterList(registers);
  return (
    sourceLine.slice(line.mnemonic.loc.start, list.loc.start) +
    (written === written.toUpperCase() ? formatted.toUpperCase() : formatted) +
    sourceLine.slice(list.loc.end, last.loc.end)
  );
}

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
      note: "Follows every path from a register save (`movem` to the stack, or `PUSHM`) to the matching restore. Only leaf code is examined: a call, trap, macro or unknown jump in between could change the register, and a save that keeps that from the caller is doing its job. Left alone where anything reads the stack by offset, since removing a register moves the offsets. Reported on the save. The fix trims the list on the save and every matching restore together, or removes them all when nothing needs saving. A word save is not fixed automatically, because its restore sign-extends and so changes the register's upper word.",
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

      // The rewrite: the trimmed list on the save and on every restore, or
      // all of them removed when nothing is left to save. A word save is left
      // to be done by hand, because its restore sign-extends: it changes the
      // upper word of a register the code itself never touched.
      const lines = [
        { at: index, kind: "push" as const },
        ...restores.map((at) => ({ at, kind: "pop" as const })),
      ];
      // One register left is moved with MOVE, which costs less. MOVE sets
      // the flags MOVEM leaves alone, so where they may still be read after a
      // line, as by a caller after a return, the fix rests on that not
      // mattering and is a conditional one.
      const asMove = kept.length === 1 && moveBeatsSingleRegisterMovem(ctx);
      const flagsReadAfter = asMove
        ? lines.filter(
            ({ at, kind }) =>
              singleRegisterMoveSafety(ctx, at, kept[0], kind === "pop")
                .applicability !== "safe",
          )
        : [];
      const rewrites =
        save.bytesEach === 4
          ? lines.map(({ at, kind }) => ({
              at,
              text:
                kept.length === 0
                  ? ""
                  : asMove
                    ? asSingleMove(
                        ctx.file.lines[at],
                        ctx.sourceLine(at) ?? "",
                        kind,
                        kept[0],
                      )
                    : withRegisterList(
                        ctx.file.lines[at],
                        ctx.sourceLine(at) ?? "",
                        kind,
                        kept,
                      ),
            }))
          : [];
      const fixable =
        rewrites.length > 0 && rewrites.every(({ text }) => text !== undefined);

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
          ...(fixable && flagsReadAfter.length
            ? [
                {
                  message: `MOVE sets N/Z/V/C, which MOVEM leaves as they were. They may still be read after line ${flagsReadAfter
                    .map(({ at }) => ctx.line(at)?.lineNumber ?? at + 1)
                    .join(
                      ", ",
                    )}, for example by a caller testing them after the return.`,
                },
              ]
            : []),
        ],
        suggestion: {
          description:
            kept.length === 0
              ? "Remove the save and its restore"
              : `Save only ${formatRegisterList(kept).toUpperCase()}${asMove ? " with MOVE" : ""}, in the save and every matching restore`,
          ...(fixable
            ? {
                replacement: rewrites[0].text,
                edits: rewrites.slice(1).map(({ at, text }) => ({
                  span: { startLine: at + 1, endLine: at + 1 },
                  replacement: text!,
                })),
              }
            : {}),
          applicability: !fixable
            ? "manual"
            : flagsReadAfter.length
              ? "conditional"
              : "safe",
        },
        data: { unneeded, kept, restores },
      });
    });
  },
};

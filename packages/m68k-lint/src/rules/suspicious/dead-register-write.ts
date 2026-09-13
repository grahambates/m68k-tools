import type { OperandNode, ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { getFlagSemantics } from "../../semantics/flags.js";
import { getRegisterSemantics } from "../../semantics/registers.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { instructionSize } from "../../util/ast.js";

/**
 * A write whose value is overwritten before anything reads it does nothing:
 *
 *   move.w d0,d1      <- d1 is never read
 *   move.w d2,d1
 *   move.w d1,foo(a0)
 *
 * Often a typo — the first write was meant for a different register — so the
 * instruction is worth looking at even where the wasted cycles do not matter.
 *
 * The instruction must do nothing except write one register and set flags, both
 * of which have to be provably unused. A load from memory still counts, but the
 * removal is only ever offered for review: the address may be a hardware
 * register that changes state when read, and dropping the load would change
 * behaviour rather than just save time. LEA is not a load - it computes an
 * address without dereferencing it - so it keeps the plain reading.
 */
const CONTROL_FLOW_SAFE = new Set(["none", "fallthrough"]);

/** Operands that are just a register or a literal, with nothing else going on. */
function isInertOperand(op: OperandNode): boolean {
  return (
    op.type === "data-register" ||
    op.type === "address-register" ||
    op.type === "immediate"
  );
}

/**
 * Whether removing the instruction could lose a memory access. LEA never
 * dereferences, so it is exempt however its operand is written. Postincrement
 * and predecrement do not reach here: they write their address register too, so
 * the single-register check below excludes them.
 */
function readsMemory(line: ParsedLine, mnemonic: string): boolean {
  if (mnemonic === "lea") return false;
  return (line.operands ?? []).some((op) => !isInertOperand(op));
}

/** The bits a narrow write covers, or nothing when the write is full width. */
function partialWriteMask(
  line: ParsedLine,
  isPartial: boolean,
): number | undefined {
  if (!isPartial) return undefined;
  const size = instructionSize(line);
  if (size === "b") return 0xff;
  if (size === "w") return 0xffff;
  return undefined;
}

export const deadRegisterWrite: Rule = {
  meta: {
    id: "suspicious/dead-register-write",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a register write whose value is overwritten before it is read",
    tags: ["dataflow", "register-analysis", "dead-code", "likely-typo"],
    docs: {
      note: "Usually a typo, where the write was meant for a different register, rather than an intentional waste of two bytes. Restricted to instructions that write one register and its flags, both provably unused. A load from memory is reported but never offered as a safe removal, since the address may change state when read.",
    },
  },

  checkLine(ctx, line, index) {
    const mnemonic = semanticMnemonic(line);
    if (!mnemonic) return;
    if (!(line.operands ?? []).length) return;

    const registers = getRegisterSemantics(line);
    if (registers.unknownEffects || registers.call) return;
    // Exactly one register written, so MOVEM and friends are out, and the
    // instruction must not read the register it writes: `add d0,d1` reads d1,
    // but removing it is still sound only if d1 is dead, which the check below
    // establishes. What matters here is that nothing else is affected.
    if (registers.writes.size !== 1) return;
    const [written] = [...registers.writes];

    const flags = getFlagSemantics(line);
    if (!CONTROL_FLOW_SAFE.has(flags.controlFlow)) return;

    // Whole-register liveness treats a byte or word write to a data register as
    // preserving what was there, which it does, so it never calls such a write
    // dead. The narrower question is whether the bits this instruction actually
    // writes are read again, and that is the one the rule needs: in
    // `move.w d0,d1 / move.w d2,d1 / move.w d1,(a0)` the first write is dead
    // even though D1 itself is live throughout.
    const writtenBits = partialWriteMask(
      line,
      registers.partialWrites.has(written),
    );
    const dead =
      ctx.registers.isLiveAfter(index, written) === "dead" ||
      (writtenBits !== undefined &&
        ctx.registers.registerBitsUseAfter(index, written, writtenBits) ===
          "unused");
    if (!dead) return;
    // Removing the instruction removes its flag effects too.
    for (const flag of [...flags.writes, ...flags.undefined]) {
      if (ctx.flags.isLiveAfter(index, flag) !== "dead") return;
    }

    const fromMemory = readsMemory(line, mnemonic);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: fromMemory ? "medium" : "certain",
      message: `${written.toUpperCase()} is overwritten before it is read, so this instruction has no effect`,
      loc: line.mnemonic!.loc,
      suggestion: fromMemory
        ? {
            description:
              "Remove the instruction, if the load has no side effect",
            applicability: "manual",
          }
        : {
            description: "Remove the instruction",
            replacement: "",
            applicability: "safe",
          },
      notes: [
        {
          message: `Nothing reads ${written.toUpperCase()} between this write and the next one.`,
        },
        {
          message:
            "The condition codes it sets are also unused, so removing it changes nothing.",
        },
        {
          message:
            "Worth checking the destination is the register you meant: a write nothing reads is often a typo rather than dead weight.",
        },
        ...(fromMemory
          ? [
              {
                message:
                  "The value comes from memory, so removing the instruction also removes the read. Check the address is not a register that changes state when read.",
              },
            ]
          : []),
      ],
      data: { register: written, fromMemory },
    });
  },
};

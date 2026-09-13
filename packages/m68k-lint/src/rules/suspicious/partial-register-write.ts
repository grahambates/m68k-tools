import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import {
  getRegisterSemantics,
  type Register,
} from "../../semantics/registers.js";
import type { RuleContext } from "../../core/context.js";
import { dataRegisterOperand, instructionSize } from "../../util/ast.js";

/**
 * The routine a line belongs to: from the nearest label that is not local, up
 * to the next one.
 *
 * A local label is a branch target inside a routine, so it does not start a new
 * one. Anything above the first global label, or below the last, is bounded by
 * the file.
 */
function enclosingBlock(
  ctx: RuleContext,
  index: number,
): { start: number; end: number } {
  let start = 0;
  for (let i = index; i >= 0; i--) {
    if (ctx.line(i)?.label?.scope === "global") {
      start = i;
      break;
    }
  }
  let end = ctx.file.lines.length;
  for (let i = index + 1; i < ctx.file.lines.length; i++) {
    if (ctx.line(i)?.label?.scope === "global") {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Which bits of the register the routine puts a value into.
 *
 * The question this rule is really asking is not whether some single
 * instruction writes the register whole, but whether the preserved bits hold
 * something the author put there. Building a long out of several narrow writes
 * is ordinary: `move.w d3,d4` then `move.b d2,d4` defines the whole low word
 * between them, and the byte write preserving bits 8-15 is the point of it.
 * Only bits that nothing in the routine ever writes are effectively undefined,
 * and those are what is worth reporting.
 *
 * A write only counts if it does not also read. DIVU takes a 32-bit dividend
 * and writes a 32-bit result, so it both consumes the upper half and replaces
 * it; counting that as establishing the register excused the exact bug this
 * rule exists to catch, a divide after only the low word was set.
 *
 * SWAP counts for everything, though it reads what it writes. It is how the
 * upper half is addressed at all, so a routine containing one is working both
 * halves on purpose: `move.w` / `swap` / `move.w` defines all 32 bits, the
 * unknown half having been rotated down and overwritten.
 */
function establishedBitsInBlock(
  ctx: RuleContext,
  register: Register,
  block: { start: number; end: number },
): number {
  let established = 0;
  for (let i = block.start; i < block.end; i++) {
    const line = ctx.line(i);
    if (!line || line.mnemonic?.type !== "instruction") continue;
    if (
      semanticMnemonic(line) === "swap" &&
      dataRegisterOperand(line, 0)?.register.toLowerCase() === register
    ) {
      return 0xffffffff;
    }
    const semantics = getRegisterSemantics(line);
    if (semantics.reads.has(register) || !semantics.writes.has(register))
      continue;
    if (!semantics.partialWrites.has(register)) return 0xffffffff;
    const size = instructionSize(line);
    established |= size === "b" ? 0xff : size === "w" ? 0xffff : 0;
  }
  return established >>> 0;
}

export const partialRegisterWrite: Rule = {
  meta: {
    id: "suspicious/partial-register-write",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag byte/word MOVE writes whose preserved upper bits are subsequently used",
    docs: {
      note: "Only reported where the routine never writes the register whole. Building a long from its halves, or seeding one with a known value first, accounts for the preserved bits; this is for the case where they are whatever happened to be there on entry.",
    },
    tags: ["data-registers", "partial-width", "dataflow"],
  },

  checkLine(ctx, line, index) {
    if (semanticMnemonic(line) !== "move") return;
    const size = instructionSize(line);
    if (size !== "b" && size !== "w") return;
    const destination = dataRegisterOperand(line, 1);
    if (!destination) return;

    // Seeding the register with a known value and then writing part of it is
    // the ordinary way to zero- or sign-extend a narrow load:
    //
    //   moveq  #0,d2
    //   move.b 0(a2,d1.w),d2
    //
    // The preserved bits are the point, not an oversight. Constant propagation
    // supplies the value, so the seed does not have to be the previous
    // instruction, and CLR works as well as MOVEQ.
    if (
      ctx.registers.knownConstantBefore(index, destination.register) !==
      undefined
    )
      return;

    // Narrow the question to the bits nothing in the routine ever writes.
    // Populating a register across several narrow writes is construction, so
    // only what is left effectively undefined is worth asking about.
    const register = destination.register.toLowerCase() as Register;
    const established = establishedBitsInBlock(
      ctx,
      register,
      enclosingBlock(ctx, index),
    );
    const upperMask = size === "b" ? 0xffffff00 : 0xffff0000;
    const undefinedBits = (upperMask & ~established) >>> 0;
    if (undefinedBits === 0) return;

    const use = ctx.registers.registerBitsUseAfter(
      index,
      destination.register,
      undefinedBits,
    );
    if (use !== "used") return;

    const preserved =
      undefinedBits === 0xffffff00
        ? "upper 24 bits"
        : undefinedBits === 0xffff0000
          ? "upper 16 bits"
          : "upper bits";
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "medium",
      message: `MOVE.${size.toUpperCase()} preserves the ${preserved} of ${destination.register.toUpperCase()}, and later code reads them`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          "Review whether the preserved upper bits are intentional; clear/extend or use a full-width write if not",
        applicability: "manual",
      },
    });
  },
};

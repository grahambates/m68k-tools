import type { OperandNode, ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { isAddressRegisterWriteWithoutCCR } from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import {
  normalizeRegister,
  registersReadByOperand,
  type Register,
} from "../../semantics/registers.js";
import {
  changedFlagsApplicability,
  hasLabelBetween,
  sourceOperand,
} from "./helpers.js";

/**
 * Consumers that can take the folded value as a source operand.
 *
 * EOR is deliberately absent: the 68k only encodes `EOR Dn,<ea>`, so there is
 * no `EOR <ea>,Dn` for a folded source to go into. Writing one produces an
 * instruction the assembler will reject, which is why this cannot simply be
 * "any operation taking a source EA".
 */
const FOLDABLE = new Set([
  "add",
  "adda",
  "sub",
  "suba",
  "and",
  "or",
  "cmp",
  "cmpa",
  "move",
  "movea",
]);

/**
 * Sources that read the same value at the consumer's position as they did at
 * the load, so the intermediate register is carrying nothing the consumer
 * could not fetch itself.
 *
 * Post-increment and pre-decrement are left out: they are probably foldable
 * too, since the single side effect happens either way, but they interact with
 * the destination checks below in ways worth proving separately.
 */
const FOLDABLE_SOURCE = [
  "data-register",
  "address-register",
  "immediate",
  "address-register-indirect",
  "address-register-indirect-displacement",
  "address-register-indirect-index",
  "absolute-address",
  "pc-relative",
  "pc-relative-index",
];

/** Destination modes a folded operand may be written to -- alterable, so no PC-relative. */
const ALTERABLE_DESTINATION = [
  "address-register-indirect",
  "address-register-indirect-displacement",
  "address-register-indirect-index",
  "address-register-indirect-postinc",
  "address-register-indirect-predec",
  "absolute-address",
];

function foldableSource(op: OperandNode | undefined): boolean {
  return !!op && FOLDABLE_SOURCE.includes(op.type);
}

/**
 * Whether folding an immediate would actually pay.
 *
 * MOVEQ carries its value in the instruction word, so staging a long constant
 * through a register is *smaller* than embedding it in the consumer -- which
 * is exactly what `move-immediate-via-scratch` and
 * `arithmetic-immediate-via-scratch` exist to recommend. Measured on 68000,
 * folding `moveq #-1,d0 / move.l d0,$44(a6)` back into `move.l #-1,$44(a6)`
 * costs 2 bytes and 4 cycles, and the word-sized case is an exact wash. Only
 * an immediate that already pays for its own extension word, and that MOVEQ
 * could not have carried, is worth folding.
 */
function immediateWorthFolding(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  line: ParsedLine,
  source: OperandNode,
  size: "b" | "w" | "l",
): boolean {
  if (isInstruction(line, "moveq")) return false;
  if (size !== "l") return true;
  if (source.type !== "immediate" || source.value.type === "string-literal")
    return false;
  const value = ctx.evaluate(source.value);
  return !value.known || value.value < -128 || value.value > 127;
}

function destinationRegister(line: ParsedLine): Register | undefined {
  const op = operand(line, 1);
  if (op?.type === "data-register" || op?.type === "address-register")
    return normalizeRegister(op.register);
  return undefined;
}

/**
 * A value staged through a register that nothing else reads is an instruction
 * the consumer could have done without. The register is carrying the value one
 * step and then dying:
 *
 *   move.w x_speed,d1        add.w x_speed,d0
 *   add.w  d1,d0        ->
 *
 *   move.w (a1,d1.w),d3      move.w (a1,d1.w),(a0)
 *   move.w d3,(a0)      ->
 *
 * The source can be anything re-readable at the consumer's position, and the
 * consumer can be any operation with an `<ea>,Dn` form -- or MOVE, which on
 * the 68k reaches all the way to a memory destination. Measured on 68000, each
 * shape is two bytes and three to six cycles better.
 */
export const foldRedundantIntermediate: Rule = {
  meta: {
    id: "optimization/fold-redundant-intermediate",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Drop an intermediate register that only carries a value into the next instruction",
    tags: ["peephole", "register-analysis", "scratch-register", "native"],
    docs: {
      note: "Found by mining a corpus of real Amiga assembly for values staged through a register that is used exactly once, then verified with 68kcounter.",
      example: {
        source: "\tmove.w d2,d1\n\tadd.w d1,d0\n\tmoveq #0,d1\n\trts",
      },
    },
  },

  checkLine(ctx, line, index) {
    // MOVEQ is a load too, and reaches here so its immediate can be judged
    // against the folded form rather than assumed foldable.
    const isMoveq = isInstruction(line, "moveq");
    if (!isInstruction(line, "move") && !isMoveq) return;
    const size = isMoveq ? "l" : instructionSize(line);
    if (size !== "b" && size !== "w" && size !== "l") return;
    const source = operand(line, 0);
    const scratchOperand = dataRegisterOperand(line, 1);
    if (!source || !foldableSource(source) || !scratchOperand) return;
    if (
      source.type === "immediate" &&
      !immediateWorthFolding(ctx, line, source, size)
    )
      return;
    const scratch = normalizeRegister(scratchOperand.register);
    if (!scratch) return;

    const next = ctx.nextInstruction(index);
    if (!next || hasLabelBetween(ctx, index, next.index)) return;
    const mnemonic = semanticMnemonic(next.line);
    if (!mnemonic || !FOLDABLE.has(mnemonic)) return;
    if (instructionSize(next.line) !== size) return;

    // The intermediate register has to be what the consumer reads, and it must
    // not also be what the consumer writes -- `add.w d1,d1` has nowhere to fold to.
    const consumed = dataRegisterOperand(next.line, 0);
    if (!consumed || normalizeRegister(consumed.register) !== scratch) return;
    const destinationOperand = operand(next.line, 1);
    const destination = destinationRegister(next.line);
    if (destination === scratch) return;

    // Whether a memory destination is reachable is a property of the encoding,
    // not of the shape being matched: arithmetic only has an `<ea>,Dn` form,
    // while MOVE is the one that reaches memory, which is where the 68k's
    // memory-to-memory move comes from.
    if (
      !destination &&
      !(
        mnemonic === "move" &&
        destinationOperand &&
        ALTERABLE_DESTINATION.includes(destinationOperand.type)
      )
    )
      return;

    // ADDA.B/SUBA.B/MOVEA.B do not exist, so a byte-sized fold has nowhere to go.
    const addressDestination = destinationOperand?.type === "address-register";
    if (addressDestination && size === "b") return;

    // Folding moves the load to where the consumer is, so the consumer's own
    // destination must not be part of the address being loaded from.
    if (destination && registersReadByOperand(source).has(destination)) return;

    // A memory destination is evaluated after the load in the original pair, so
    // it may currently be reading the intermediate register's new value. Folded,
    // it would see the old one instead.
    if (!destination && registersReadByOperand(destinationOperand).has(scratch))
      return;

    // Nothing else may need the staged value.
    if (ctx.registers.isLiveAfter(next.index, scratch) !== "dead") return;

    const sourceText = sourceOperand(ctx, line, 0);
    const destinationText = sourceOperand(ctx, next.line, 1);
    const written =
      next.line.mnemonic?.type === "instruction"
        ? next.line.mnemonic.instruction.toLowerCase()
        : undefined;
    if (!sourceText || !destinationText || !written) return;

    // ADDA/SUBA/MOVEA leave the condition codes alone, so the MOVE's N/Z/V/C
    // are the ones that survive the original pair. Folding the MOVE away
    // removes them, which only matters if something downstream reads them.
    // Every other consumer here sets N/Z/V/C itself, overwriting the MOVE's
    // either way.
    const preservesCcr = isAddressRegisterWriteWithoutCCR(next.line);
    const safety = preservesCcr
      ? changedFlagsApplicability(ctx, next.index, ["N", "Z", "V", "C"])
      : { applicability: "safe" as const, confidence: "certain" as const };

    const replacement = `${written}.${size} ${sourceText},${destinationText}`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${scratch.toUpperCase()} only carries ${sourceText} into the next instruction, which can read it directly`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${replacement.toUpperCase()} and drop the separate load`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `${scratch.toUpperCase()} is proven dead after the pair, so the staged copy is not needed.`,
        },
        ...(preservesCcr && safety.applicability !== "safe"
          ? [
              {
                message:
                  "The folded form drops the MOVE's N/Z/V/C, which this consumer does not set for an address-register destination; review later flag use.",
              },
            ]
          : []),
      ],
      data: { sourceEndIndex: next.index, scratch },
    });
  },
};

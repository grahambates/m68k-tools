import type { Rule } from "../../core/rule.js";
import { canonicalMnemonic } from "../../semantics/mnemonics.js";
import { instructionSize } from "../../util/ast.js";

const REQUIRE_EXPLICIT_SIZE = new Set([
  "move",
  "movea",
  "add",
  "adda",
  "addq",
  "addx",
  "sub",
  "suba",
  "subq",
  "subx",
  "cmp",
  "cmpa",
  "cmpm",
  "and",
  "or",
  "eor",
  "clr",
  "neg",
  "negx",
  "not",
  "tst",
  "asl",
  "asr",
  "lsl",
  "lsr",
  "rol",
  "ror",
  "roxl",
  "roxr",
  "movem",
  "movep",
  "ext",
]);

const FIXED_SIZE = new Set([
  "lea",
  "pea",
  "moveq",
  "swap",
  "exg",
  "jmp",
  "jsr",
  "nop",
  "reset",
  "rte",
  "rtr",
  "rts",
  "stop",
  "trap",
  "illegal",
  "unlk",
  "tas",
  "nbcd",
  "abcd",
  "sbcd",
  "pack",
  "unpk",
]);

const CONDITION_CODES = new Set([
  "t",
  "f",
  "hi",
  "ls",
  "cc",
  "cs",
  "ne",
  "eq",
  "vc",
  "vs",
  "pl",
  "mi",
  "ge",
  "lt",
  "gt",
  "le",
]);

function isFixedSizeConditionInstruction(mnemonic: string): boolean {
  if (mnemonic.startsWith("db") && CONDITION_CODES.has(mnemonic.slice(2)))
    return true;
  if (mnemonic.startsWith("s") && CONDITION_CODES.has(mnemonic.slice(1)))
    return true;
  return false;
}

function removeSizeQualifier(
  sourceLine: string,
  mnemonic: string,
  size: string,
): string | undefined {
  const escaped = mnemonic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\.${size}\\b`, "i");
  if (!pattern.test(sourceLine)) return undefined;
  return sourceLine.replace(pattern, (match) =>
    match.slice(0, match.lastIndexOf(".")),
  );
}

export const requireInstructionSize: Rule = {
  meta: {
    id: "style/require-instruction-size",
    category: "style",
    defaultSeverity: "info",
    enabledByDefault: false,
    presets: ["style"],
    description:
      "Require an explicit size suffix on instructions with multiple operand sizes",
    tags: ["style", "size-qualifier"],
  },
  checkLine(ctx, line) {
    if (line.mnemonic?.type !== "instruction" || instructionSize(line)) return;
    const mnemonic = canonicalMnemonic(line);
    if (!mnemonic || !REQUIRE_EXPLICIT_SIZE.has(mnemonic)) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Specify the operand size explicitly for ${line.mnemonic.instruction.toUpperCase()}`,
      loc: line.mnemonic.loc,
      notes: [
        {
          message:
            "The intended size cannot be inferred safely by the linter; add .b, .w, or .l as appropriate.",
        },
      ],
    });
  },
};

export const omitRedundantInstructionSize: Rule = {
  meta: {
    id: "style/omit-redundant-instruction-size",
    category: "style",
    defaultSeverity: "info",
    enabledByDefault: false,
    presets: ["style"],
    description:
      "Omit size suffixes from instructions whose operation has a fixed size",
    tags: ["style", "size-qualifier"],
  },
  checkLine(ctx, line, index) {
    if (line.mnemonic?.type !== "instruction") return;
    const size = instructionSize(line);
    if (!size) return;
    const mnemonic = canonicalMnemonic(line);
    if (
      !mnemonic ||
      (!FIXED_SIZE.has(mnemonic) && !isFixedSizeConditionInstruction(mnemonic))
    )
      return;

    const replacement = removeSizeQualifier(
      ctx.sourceLine(index) ?? "",
      line.mnemonic.instruction,
      size,
    );
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `${line.mnemonic.instruction.toUpperCase()} has no variable operand size; .${size} is redundant`,
      loc: line.mnemonic.loc,
      suggestion: replacement
        ? {
            description: "Remove the redundant size suffix",
            replacement,
            applicability: "safe",
          }
        : undefined,
    });
  },
};

import type { ExpressionNode } from "m68k-parser";
import type { Rule } from "../../../core/rule.js";
import type { RuleContext } from "../../../core/context.js";
import { analyzeSections, type Section } from "../../../analysis/sections.js";
import { conditionalAssembly } from "../../../analysis/conditionals.js";
import { scanBlocks } from "../../../analysis/blocks.js";
import { replaceOperandInLine } from "../../optimization/helpers.js";

/**
 * The label a PC-relative displacement points at: the label alone, or offset
 * by a constant. Anything else, such as the difference of two labels, is not
 * a reference into another section.
 */
function targetLabel(
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

/**
 * Hunk executables have no relocation for a PC-relative reference between
 * hunks: vasm rejects one when writing an executable, and vlink when linking
 * hunk objects. vlink's small code (`-sc`) and small data (`-sd`) options merge
 * sections of one kind into a single hunk, which settles references between
 * code sections, or among data and BSS, but never from one kind to the other.
 */
export const amigaCrossSectionPcRelative: Rule = {
  meta: {
    id: "correctness/amiga-cross-section-pc-relative",
    category: "correctness",
    defaultSeverity: "error",
    platforms: ["amiga"],
    description: "Flag a PC-relative reference to a label in another section",
    tags: ["amiga", "sections", "pc-relative", "relocation"],
    docs: {
      source: "vasm",
      note: "Each section becomes its own hunk, loaded wherever AmigaDOS finds memory, so the distance from one to another is not known until run time. vasm rejects the reference when writing an executable, and vlink when linking objects. Linking with small code (`-sc`) or small data (`-sd`) merges sections of one kind, which settles a reference between two code sections or among data and BSS; those findings carry a conditional fix. A reference from code to data or BSS never assembles, and its fix is safe. Only labels this file defines are checked, and the section is not followed through an INCLUDE, a macro that may change it, ORG or OFFSET.",
      example: {
        source: [
          "\tsection\tcode,code",
          "\tlea\ttable(pc),a0",
          "\tsection\tdata,data",
          "table:\tdc.w\t0",
        ].join("\n"),
        config: { platform: "amiga" },
      },
    },
  },

  checkFile(ctx) {
    const sections = analyzeSections(ctx.file);
    const blocks = scanBlocks(ctx.file);
    const assembly = conditionalAssembly(ctx.file);

    ctx.file.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "instruction") return;
      if (blocks.region[index] !== 0 || assembly.unassembled[index]) return;
      const from = sections.at(index);
      if (!from) return;

      (line.operands ?? []).forEach((op, operandIndex) => {
        if (op.type !== "pc-relative" && op.type !== "pc-relative-index")
          return;
        if (!op.displacement) return;
        const name = targetLabel(ctx, op.displacement);
        if (name === undefined) return;
        const to = sections.ofLabel(index, name);
        if (!to || to.key === from.key) return;
        report(ctx, index, operandIndex, name, from, to);
      });
    });
  },
};

const mergeable = (a: Section, b: Section) =>
  (a.kind === "code") === (b.kind === "code");

function report(
  ctx: RuleContext,
  index: number,
  operandIndex: number,
  name: string,
  from: Section,
  to: Section,
): void {
  const line = ctx.file.lines[index];
  const op = line.operands![operandIndex];
  const merge = mergeable(from, to);
  const option = to.kind === "code" ? "small code (-sc)" : "small data (-sd)";

  const notes = [
    {
      message: `${name} is in ${describe(to)}, and this instruction in ${describe(from)}. Sections are separate hunks, loaded independently, so the distance between them is not known when assembling and there is no relocation to fix it up when loading.`,
    },
    merge
      ? {
          message: `This assembles only if the two sections are merged into one hunk, as linking with ${option} does. Without that, vasm rejects it when writing an executable, and vlink when linking.`,
        }
      : {
          message:
            "Code and data sections are never merged into one hunk, so this cannot assemble into an executable.",
        },
  ];

  if (op.type === "pc-relative-index") {
    ctx.report({
      ruleId: amigaCrossSectionPcRelative.meta.id,
      category: amigaCrossSectionPcRelative.meta.category,
      severity: amigaCrossSectionPcRelative.meta.defaultSeverity,
      confidence: merge ? "high" : "certain",
      message: `PC-relative reference to ${name} in another section`,
      loc: op.loc,
      notes,
      suggestion: {
        description: `Load the address with lea ${name},An and index from that register, or move ${name} into this section`,
        applicability: "manual",
      },
    });
    return;
  }

  const target =
    op.type === "pc-relative" ? ctx.sourceTextOf(op.displacement) : undefined;
  const replacement =
    target && replaceOperandInLine(ctx, line, operandIndex, target);

  ctx.report({
    ruleId: amigaCrossSectionPcRelative.meta.id,
    category: amigaCrossSectionPcRelative.meta.category,
    severity: amigaCrossSectionPcRelative.meta.defaultSeverity,
    confidence: merge ? "high" : "certain",
    message: `PC-relative reference to ${name} in another section`,
    loc: op.loc,
    notes: [
      ...notes,
      {
        message:
          "An absolute address is relocated when the program loads. It is 2 bytes longer than the PC-relative form and makes the instruction position-dependent.",
      },
    ],
    suggestion: {
      description: `Use the absolute address ${target ?? name}`,
      ...(replacement ? { replacement } : {}),
      applicability: replacement ? (merge ? "conditional" : "safe") : "manual",
    },
  });
}

/** `the data section` for a shorthand like DATA, `section vars (bss)` for a named one. */
function describe(section: Section): string {
  return section.label === section.kind
    ? `the ${section.kind} section`
    : `section ${section.label} (${section.kind})`;
}

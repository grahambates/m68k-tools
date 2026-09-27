import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../../core/rule.js";
import type { RuleContext } from "../../../core/context.js";
import { analyzeSections, type Section } from "../../../analysis/sections.js";
import { targetLabel } from "../../../analysis/label-addresses.js";
import { conditionalAssembly } from "../../../analysis/conditionals.js";
import { scanBlocks } from "../../../analysis/blocks.js";
import { canonicalMnemonic } from "../../../semantics/mnemonics.js";
import { replaceOperandInLine } from "../../optimization/helpers.js";

/** Each condition and its opposite. */
const INVERSE: Record<string, string> = {
  hi: "ls",
  ls: "hi",
  cc: "cs",
  cs: "cc",
  ne: "eq",
  eq: "ne",
  vc: "vs",
  vs: "vc",
  pl: "mi",
  mi: "pl",
  ge: "lt",
  lt: "ge",
  gt: "le",
  le: "gt",
};

type Branch =
  | { kind: "call" | "jump"; target: number }
  | { kind: "conditional"; condition: string; target: number }
  | { kind: "loop"; target: number };

/** A branch instruction and which operand is its target. */
function branchOf(line: ParsedLine): Branch | undefined {
  const mnemonic = canonicalMnemonic(line);
  if (mnemonic === "bsr") return { kind: "call", target: 0 };
  if (mnemonic === "bra") return { kind: "jump", target: 0 };
  const condition = mnemonic?.startsWith("b") ? mnemonic.slice(1) : undefined;
  if (condition && condition in INVERSE)
    return { kind: "conditional", condition, target: 0 };
  if (
    /^db(t|f|hi|ls|cc|cs|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/.test(mnemonic ?? "")
  )
    return { kind: "loop", target: 1 };
  return undefined;
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
    description:
      "Flag a PC-relative reference or branch to a label in another section",
    tags: ["amiga", "sections", "pc-relative", "relocation"],
    docs: {
      source: "vasm",
      note: "Each section becomes its own hunk, loaded wherever AmigaDOS finds memory, so the distance from one to another is not known until run time. vasm rejects the reference when writing an executable, and vlink when linking objects. This covers `(pc)` operands and every branch: BSR and BRA are fixed as JSR and JMP, while Bcc and DBcc have no single-instruction absolute form and are left to be rewritten by hand. Linking with small code (`-sc`) or small data (`-sd`) merges sections of one kind, which settles a reference between two code sections or among data and BSS; those findings carry a conditional fix. A reference from code to data or BSS never assembles, and its fix is safe. Only labels this file defines are checked, and the section is not followed through an INCLUDE, a macro that may change it, ORG or OFFSET.",
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

      const branch = branchOf(line);
      if (branch) {
        const op = line.operands?.[branch.target];
        if (op?.type !== "absolute-address") return;
        const name = targetLabel(ctx, op.address);
        if (name === undefined) return;
        const to = sections.ofLabel(index, name);
        if (to && to.key !== from.key)
          reportBranch(ctx, index, branch, name, from, to);
        return;
      }

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

/** Why a reference between these two sections fails, and when it would not. */
function sectionNotes(name: string, from: Section, to: Section) {
  const option = to.kind === "code" ? "small code (-sc)" : "small data (-sd)";
  return [
    {
      message: `${name} is in ${describe(to)}, and this instruction in ${describe(from)}. Sections are separate hunks, loaded independently, so the distance between them is not known when assembling and there is no relocation to fix it up when loading.`,
    },
    mergeable(from, to)
      ? {
          message: `This assembles only if the two sections are merged into one hunk, as linking with ${option} does. Without that, vasm rejects it when writing an executable, and vlink when linking.`,
        }
      : {
          message:
            "Code and data sections are never merged into one hunk, so this cannot assemble into an executable.",
        },
  ];
}

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
  const notes = sectionNotes(name, from, to);

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

function reportBranch(
  ctx: RuleContext,
  index: number,
  branch: Branch,
  name: string,
  from: Section,
  to: Section,
): void {
  const line = ctx.file.lines[index];
  const op = line.operands![branch.target];
  const merge = mergeable(from, to);
  const target = ctx.sourceTextOf(op) ?? name;
  const base = {
    ruleId: amigaCrossSectionPcRelative.meta.id,
    category: amigaCrossSectionPcRelative.meta.category,
    severity: amigaCrossSectionPcRelative.meta.defaultSeverity,
    confidence: merge ? ("high" as const) : ("certain" as const),
    message: `Branch to ${name} in another section`,
    loc: op.loc,
  };
  const notes = sectionNotes(name, from, to);

  if (branch.kind === "conditional" || branch.kind === "loop") {
    ctx.report({
      ...base,
      notes,
      suggestion: {
        description:
          branch.kind === "conditional"
            ? `Branch over a JMP on the opposite condition: b${INVERSE[branch.condition]}.s *+8 then jmp ${target}, or move ${name} into this section`
            : `Point it at a jmp ${target} placed in this section, or move ${name} into this section`,
        applicability: "manual",
      },
    });
    return;
  }

  // BSR becomes JSR and BRA becomes JMP, in the case the source was written in,
  // dropping any size: the absolute form has only the one.
  const source = ctx.sourceLine(index);
  const mnemonic = line.mnemonic!;
  const written = source?.slice(mnemonic.loc.start, mnemonic.loc.end) ?? "";
  const absolute = branch.kind === "call" ? "jsr" : "jmp";
  const spacing = source?.slice(
    line.qualifier?.loc?.end ?? mnemonic.loc.end,
    op.loc.start,
  );
  const replacement =
    source === undefined
      ? undefined
      : `${written === written.toUpperCase() ? absolute.toUpperCase() : absolute}${spacing}${target}`;

  ctx.report({
    ...base,
    notes: [
      ...notes,
      {
        message: `${absolute.toUpperCase()} to an absolute address is relocated when the program loads. It is 6 bytes, where the branch was 2 or 4, and takes 2 more cycles on a 68000.`,
      },
    ],
    suggestion: {
      description: `Use ${absolute} ${target}`,
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

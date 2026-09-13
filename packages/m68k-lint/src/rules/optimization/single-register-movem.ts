import type { OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { instructionSize, isInstruction, operand } from "../../util/ast.js";
import { changedFlagsApplicability, sourceOperand } from "./helpers.js";

function singleRegister(op: OperandNode | undefined): string | undefined {
  if (!op) return undefined;
  if (op.type === "data-register" || op.type === "address-register")
    return op.register;
  if (op.type === "register-list" && op.registers.length === 1)
    return op.registers[0];
  return undefined;
}

function replacementMnemonic(): string {
  // Both branches of the original ternary returned "move". Kept as a function so
  // the call sites stay unchanged if MOVEA is ever wanted for address destinations.
  return "move";
}

export const singleRegisterMovem: Rule = {
  meta: {
    id: "optimization/single-register-movem",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use MOVE instead of MOVEM for a single register",
    tags: ["asp68k", "movem", "ccr"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "movem")) return;
    if (
      !ctx.config.processors.every((cpu) =>
        ["mc68000", "mc68010", "mc68030", "mc68040"].includes(cpu),
      )
    )
      return;
    const size = instructionSize(line) ?? "l";
    const left = operand(line, 0);
    const right = operand(line, 1);
    const leftReg = singleRegister(left);
    const rightReg = singleRegister(right);
    if (!!leftReg === !!rightReg) return; // exactly one side must be the single-register list

    const register = leftReg ?? rightReg!;
    const registerIsDest = !!rightReg;
    if (
      registerIsDest &&
      size === "w" &&
      register.toLowerCase().startsWith("d")
    )
      return; // MOVEM.W sign-extends into Dn

    const sourceText = sourceOperand(ctx, line, 0);
    const destText = sourceOperand(ctx, line, 1);
    if (!sourceText || !destText) return;
    const replacement = `${replacementMnemonic()}.${size} ${sourceText},${destText}`;

    // MOVEM preserves CCR. MOVE to Dn/memory writes NZVC; MOVE to An is MOVEA-like and preserves CCR.
    const replacementPreservesFlags =
      registerIsDest &&
      (register.toLowerCase().startsWith("a") ||
        register.toLowerCase() === "sp");
    const safety = replacementPreservesFlags
      ? { applicability: "safe" as const, confidence: "certain" as const }
      : changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: "MOVEM with one register can use MOVE",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${replacement.toUpperCase()}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "MOVEM preserves CCR while the MOVE replacement may update N/Z/V/C; review flag use.",
              },
            ]),
      ],
    });
  },
};

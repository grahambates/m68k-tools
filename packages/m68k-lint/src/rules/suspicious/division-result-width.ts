import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import {
  getRegisterSemantics,
  normalizeRegister,
} from "../../semantics/registers.js";
import {
  dataRegisterOperand,
  instructionSize,
  wordFormSize,
} from "../../util/ast.js";

const numericUses = new Set([
  "add",
  "addq",
  "addx",
  "adda",
  "sub",
  "subq",
  "subx",
  "suba",
  "cmp",
  "cmpa",
  "tst",
  "neg",
  "negx",
  "movea",
  "mulu",
  "muls",
  "divu",
  "divs",
]);

export const divisionResultWidth: Rule = {
  meta: {
    id: "suspicious/division-result-width",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag a packed word-division result used as a long quotient",
    docs: {
      source: "Motorola 68000 Family Programmer's Reference Manual, DIVS/DIVU",
      note: "After successful word division, the low word holds the quotient and the high word holds the remainder. Checks numeric and address uses along unambiguous control flow; copies and stores may intentionally preserve both halves. Extraction, register writes, calls and control-flow joins end tracking.",
    },
    tags: ["division", "partial-width", "dataflow"],
  },
  checkLine(ctx, line, index) {
    const division = semanticMnemonic(line);
    if (division !== "divu" && division !== "divs") return;
    if (wordFormSize(line) !== "w") return;
    const destination = dataRegisterOperand(line, 1);
    if (!destination) return;
    const register = normalizeRegister(destination.register)!;
    const cfg = ctx.registers.cfg;
    const visited = new Set<number>([index]);
    let current = index;
    // Follow only a single, unambiguous path. Do not infer contracts across
    // calls or merge a packed result with a value from another predecessor.
    while (!cfg.escapes[current] && cfg.successors[current].size === 1) {
      const next = [...cfg.successors[current]][0];
      if (visited.has(next) || cfg.predecessors[next].size !== 1) return;
      visited.add(next);
      current = next;
      const use = ctx.line(next);
      if (!use || use.mnemonic?.type !== "instruction") return;
      const semantics = getRegisterSemantics(use);
      if (semantics.call || semantics.unknownEffects) return;
      const name = semanticMnemonic(use)!;
      const size = instructionSize(use) ?? "w";
      const indexed = use.operands?.some(
        (op) =>
          "indexRegister" in op &&
          op.indexRegister?.type === "data-register" &&
          normalizeRegister(op.indexRegister.register) === register &&
          op.indexSize?.type === "size" &&
          op.indexSize.size === "l",
      );
      const direct = use.operands?.some(
        (op) =>
          op.type === "data-register" &&
          normalizeRegister(op.register) === register,
      );
      // Word DIV consumes a long dividend, but only a word divisor.
      const dividend =
        (name === "divu" || name === "divs") &&
        normalizeRegister(dataRegisterOperand(use, 1)?.register ?? "") ===
          register;
      if (
        indexed ||
        (direct &&
          semantics.reads.has(register) &&
          numericUses.has(name) &&
          (size === "l" || dividend))
      ) {
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: "medium",
          message: `${register.toUpperCase()} still contains the packed quotient/remainder from ${division.toUpperCase()}.W and is used as a long value`,
          loc: use.mnemonic.loc,
          notes: [
            {
              message: `Word division on line ${line.mnemonic!.loc.line} puts the quotient in bits 0–15 and the remainder in bits 16–31 on success.`,
            },
          ],
          suggestion: {
            description:
              division === "divs"
                ? "Review whether the packed result is intended; use EXT.L to sign-extend the signed quotient when a long quotient is required"
                : "Review whether the packed result is intended; mask with $FFFF to zero-extend the unsigned quotient when a long quotient is required",
            applicability: "manual",
          },
        });
        return;
      }
      // SWAP/EXT/masks/shifts explicitly manipulate the packed representation.
      // Even partial writes end tracking rather than guessing the new intent.
      if (semantics.writes.has(register)) return;
    }
  },
};

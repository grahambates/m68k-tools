import type { ExpressionNode, OperandNode, ParsedLine } from "m68k-parser";
import type { RuleContext } from "../../core/context.js";
import type { Rule } from "../../core/rule.js";
import {
  analyzeAlignment,
  type AlignmentAnalysis,
  type Parity,
} from "../../analysis/alignment.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { normalizeRegister } from "../../semantics/registers.js";
import { instructionSize } from "../../util/ast.js";

/** Processors that take an address error on a word or long access at an odd address. */
const STRICT_ALIGNMENT = ["mc68000", "mc68010", "cpu32"];

/** Instructions whose operands are not accessed at the instruction's size. */
const NO_SIZED_ACCESS = new Set([
  "lea",
  "pea",
  "jmp",
  "jsr",
  "movep",
  "bra",
  "bsr",
  "dbf",
  "link",
  "unlk",
]);

interface Address {
  parity: Parity;
  text: string;
  /** Where the address comes from: worked out from a label's position, or a value. */
  origin: "value" | "layout";
}

/** `label`, `label+n`, `n+label` or `label-n`, with the constant side evaluated. */
function symbolOffset(
  ctx: RuleContext,
  expr: ExpressionNode,
): { name: string; offset: number } | undefined {
  if (expr.type === "group") return symbolOffset(ctx, expr.expression);
  if (expr.type === "symbol") return { name: expr.name, offset: 0 };
  if (expr.type !== "binary-op") return undefined;
  if (expr.operator !== "+" && expr.operator !== "-") return undefined;

  const left = symbolOffset(ctx, expr.left);
  const right = ctx.evaluate(expr.right);
  if (left && right.known)
    return {
      name: left.name,
      offset:
        expr.operator === "+"
          ? left.offset + right.value
          : left.offset - right.value,
    };

  const constant = ctx.evaluate(expr.left);
  const symbol = symbolOffset(ctx, expr.right);
  if (expr.operator === "+" && constant.known && symbol)
    return { name: symbol.name, offset: symbol.offset + constant.value };
  return undefined;
}

function flip(parity: Parity, offset: number): Parity {
  return parity === undefined ? undefined : (((parity + offset) & 1) as Parity);
}

/**
 * The address an operand reaches, when it can be told to be odd or even.
 *
 * Numeric addresses and address registers holding a known value are exact.
 * A label is worked out from where the data before it leaves the address, so
 * it is only trusted when the label names byte data: a label on word data or an
 * instruction that is itself odd is `missing-even`'s to report, and reporting
 * every use of it as well would be the same mistake many times over.
 */
function addressOf(
  ctx: RuleContext,
  alignment: AlignmentAnalysis,
  op: OperandNode,
  index: number,
): Address | undefined {
  const fromLabel = (expr: ExpressionNode): Address | undefined => {
    const symbol = symbolOffset(ctx, expr);
    if (!symbol) return undefined;
    const at = alignment.labelLine(symbol.name, index);
    if (at === undefined) return undefined;
    const target = ctx.line(at);
    const size =
      target?.qualifier?.type === "size" ? target.qualifier.size : undefined;
    if (target?.mnemonic?.type !== "directive" || size !== "b")
      return undefined;
    const parity = flip(
      alignment.labelParity(symbol.name, index),
      symbol.offset,
    );
    return {
      parity,
      text: ctx.sourceTextOf(expr) ?? symbol.name,
      origin: "layout",
    };
  };

  const fromValue = (expr: ExpressionNode): Address | undefined => {
    const value = ctx.evaluate(expr);
    if (!value.known) return undefined;
    return {
      parity: (value.value & 1) as Parity,
      text: `$${(value.value >>> 0).toString(16).toUpperCase()}`,
      origin: "value",
    };
  };

  switch (op.type) {
    case "absolute-address":
      return fromValue(op.address) ?? fromLabel(op.address);
    case "pc-relative":
      return fromLabel(op.displacement);
    case "address-register-indirect":
    case "address-register-indirect-postinc":
    case "address-register-indirect-predec":
    case "address-register-indirect-displacement": {
      if (op.register.type !== "address-register") return undefined;
      const name = normalizeRegister(op.register.register);
      if (!name) return undefined;
      const base = ctx.registers.knownConstantBefore(index, name);
      if (base === undefined) return undefined;
      let displacement = 0;
      if (op.type === "address-register-indirect-displacement") {
        const value = ctx.evaluate(op.displacement);
        if (!value.known) return undefined;
        displacement = value.value;
      }
      const address = base + displacement;
      return {
        parity: (address & 1) as Parity,
        text: `${name.toUpperCase()} = $${(base >>> 0).toString(16).toUpperCase()}`,
        origin: "value",
      };
    }
    default:
      return undefined;
  }
}

function accessedOperands(line: ParsedLine): OperandNode[] {
  return line.operands ?? [];
}

/**
 * A word or long access at an address that is provably odd.
 *
 * On the 68000 and 68010 this is an address error, so the program crashes
 * rather than misbehaving. Only reported where the address is known: a numeric
 * constant, an address register holding one, or a label whose position follows
 * from the byte data before it.
 */
export const oddAddressAccess: Rule = {
  meta: {
    id: "suspicious/odd-address-access",
    category: "suspicious",
    defaultSeverity: "error",
    description:
      "Flag a word or long access at an address that is provably odd",
    tags: ["alignment", "crash"],
    docs: {
      note: "Only applies when a 68000, 68010 or CPU32 is a target, since later processors permit unaligned access. Never reported where the address is not known, and labels on word data or instructions are left to `missing-even`.",
    },
  },

  checkFile(ctx) {
    if (!ctx.config.processors.some((cpu) => STRICT_ALIGNMENT.includes(cpu)))
      return;
    const alignment = analyzeAlignment(ctx.file, (expr) => {
      const result = ctx.evaluate(expr);
      return result.known ? result.value : undefined;
    });

    ctx.file.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "instruction") return;
      const size = instructionSize(line);
      if (size !== "w" && size !== "l") return;
      const mnemonic = semanticMnemonic(line);
      if (!mnemonic || NO_SIZED_ACCESS.has(mnemonic)) return;

      for (const op of accessedOperands(line)) {
        const address = addressOf(ctx, alignment, op, index);
        if (address?.parity !== 1) continue;
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: address.origin === "value" ? "certain" : "high",
          message: `${mnemonic.toUpperCase()}.${size.toUpperCase()} accesses an odd address (${address.text}), which is an address error on the 68000`,
          loc: op.loc ?? line.mnemonic.loc,
          notes: [
            {
              message:
                address.origin === "layout"
                  ? "The address follows from the size of the data before this label. Check the data layout, or use a byte access."
                  : "Word and long accesses must be even. Use a byte access, or correct the address.",
            },
          ],
          suggestion: {
            description: "Use an even address or a byte-sized access",
            applicability: "manual",
          },
        });
      }
    });
  },
};

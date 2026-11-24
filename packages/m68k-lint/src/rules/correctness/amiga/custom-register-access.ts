import {
  type ExpressionNode,
  type OperandNode,
  type ParsedLine,
} from "m68k-parser";
import type { Rule } from "../../../core/rule.js";
import type { RuleContext } from "../../../core/context.js";
import { canonicalMnemonic } from "../../../semantics/mnemonics.js";
import { operand } from "../../../util/ast.js";
import { evaluateConstant } from "../../../analysis/constants.js";
import {
  getRegisterSemantics,
  normalizeRegister,
  type Register,
} from "../../../semantics/registers.js";
import { semanticMnemonic } from "../../../semantics/mnemonics.js";
import { hex } from "../../../util/format.js";
import {
  CUSTOM_BASE,
  customRegisters,
  customRegisterSymbols,
} from "@m68k-lsp/platforms";

type Access = "read" | "write" | "readwrite";
// Declared here rather than taken from the shared package, whose types are not
// published: this module's exports appear in the linter's declarations.
type RegisterAccess = "read-only" | "write-only";

interface CustomRegister {
  name: string;
  access: RegisterAccess;
}

/**
 * The custom chip registers whose direction is known, by absolute address.
 * Omission is safe and commission is not: a register absent from the shared
 * table produces no diagnostic, while a wrong direction would be a confident
 * false error.
 */
export const amigaCustomRegisters: ReadonlyMap<number, CustomRegister> =
  new Map(
    customRegisters.map((register) => [
      CUSTOM_BASE + register.offset,
      register,
    ]),
  );

// Canonical Amiga include-file symbols are commonly offsets from CUSTOM, not
// full absolute addresses. Keep this resolver local to the Amiga platform so
// external include files are not required merely to understand hardware EAs.
const amigaCustomSymbolValues = new Map<string, number>([
  ...customRegisterSymbols,
  ["custom", CUSTOM_BASE],
]);

function evaluateAmigaExpression(
  ctx: RuleContext,
  expr: ExpressionNode,
): number | undefined {
  const result = evaluateConstant(expr, (name) => {
    const project = ctx.symbols.evaluate(name);
    if (project.known) return project.value;
    return amigaCustomSymbolValues.get(name.toLowerCase());
  });
  return result.known ? result.value : undefined;
}

function knownAddressRegisterBefore(
  ctx: RuleContext,
  lineIndex: number,
  register: Register,
): number | undefined {
  const known = ctx.registers.knownConstantBefore(lineIndex, register);
  if (known !== undefined) return known;

  // Platform symbols such as CUSTOM often come from an external include and
  // therefore are invisible to the generic symbol/register analysis. Recover
  // the common `LEA CUSTOM,An` idiom locally, stopping at the first write to An.
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = ctx.line(i);
    if (!line?.mnemonic || line.mnemonic.type !== "instruction") continue;
    const semantics = getRegisterSemantics(line);
    if (!semantics.writes.has(register)) continue;

    if (semanticMnemonic(line) === "lea") {
      const source = operand(line, 0);
      const dest = operand(line, 1);
      if (
        dest?.type === "address-register" &&
        normalizeRegister(dest.register) === register &&
        source?.type === "absolute-address"
      ) {
        const value = evaluateAmigaExpression(ctx, source.address);
        if (value !== undefined) return value >>> 0;
      }
    }
    return undefined;
  }
  return undefined;
}

/** The terms of a sum, each with its sign: `a-(b+1)` is +a, -b, -1. */
function signedTerms(
  expr: ExpressionNode,
  sign = 1,
): { sign: number; expr: ExpressionNode }[] {
  if (expr.type === "group") return signedTerms(expr.expression, sign);
  if (
    expr.type === "unary-op" &&
    (expr.operator === "+" || expr.operator === "-")
  )
    return signedTerms(expr.operand, expr.operator === "-" ? -sign : sign);
  if (
    expr.type === "binary-op" &&
    (expr.operator === "+" || expr.operator === "-")
  )
    return [
      ...signedTerms(expr.left, sign),
      ...signedTerms(expr.right, expr.operator === "-" ? -sign : sign),
    ];
  return [{ sign, expr }];
}

/**
 * The register named by a displacement such as `bltamod(a6)` when the base and
 * displacement do not resolve to an address. The canonical names are offsets
 * from CUSTOM and are not used with any other base, so the name alone
 * identifies the register. A common optimisation points the base at a register
 * part way into the block and subtracts that from each name, as in
 * `bltamod-C(a6)` or `bltamod-bltcon0(a6)`, so whatever else is subtracted is
 * taken to be that adjustment.
 *
 * Exactly one register name must be added. A bare number proves nothing, and a
 * project that defines the name to something else has its own meaning for it.
 * Numeric literals are kept, so `intreqr+1(a6)` is still the low byte.
 */
function customRegisterDisplacement(
  ctx: RuleContext,
  displacement: ExpressionNode,
): number | undefined {
  let named: number | undefined;
  let adjustment = 0;
  for (const { sign, expr } of signedTerms(displacement)) {
    if (expr.type === "numeric-literal") {
      adjustment += sign * expr.value;
      continue;
    }
    if (expr.type !== "symbol" || sign < 0) continue;
    const key = expr.name.toLowerCase();
    // `custom+x(a6)` is not an offset from CUSTOM.
    if (key === "custom") return undefined;
    const canonical = amigaCustomSymbolValues.get(key);
    if (canonical === undefined) continue;
    const project = ctx.symbols.evaluate(expr.name);
    if (project.known && project.value !== canonical) return undefined;
    if (named !== undefined) return undefined;
    named = canonical;
  }
  if (named === undefined) return undefined;
  const offset = named + adjustment;
  if (offset < 0 || offset >= 0x200) return undefined;
  return CUSTOM_BASE + offset;
}

/**
 * Resolve an operand to a custom-register address, understanding both literal
 * absolute addresses and the CUSTOM-base include convention. Shared with the
 * bit/mask constant rule so both agree on what counts as a hardware register.
 */
export function amigaEffectiveAddress(
  ctx: RuleContext,
  op: OperandNode | undefined,
  lineIndex: number,
): number | undefined {
  if (!op) return undefined;

  if (op.type === "absolute-address") {
    const value = evaluateAmigaExpression(ctx, op.address);
    return value === undefined ? undefined : value >>> 0;
  }

  if (op.type === "address-register-indirect") {
    if (op.register.type !== "address-register") return undefined;
    const register = normalizeRegister(op.register.register);
    if (!register) return undefined;
    return knownAddressRegisterBefore(ctx, lineIndex, register);
  }

  if (op.type === "address-register-indirect-displacement") {
    if (op.register.type !== "address-register") return undefined;
    const register = normalizeRegister(op.register.register);
    if (!register) return undefined;
    const base = knownAddressRegisterBefore(ctx, lineIndex, register);
    const displacement = evaluateAmigaExpression(ctx, op.displacement);
    if (base === undefined || displacement === undefined)
      return customRegisterDisplacement(ctx, op.displacement);
    return (base + displacement) >>> 0;
  }

  return undefined;
}

function operandAccess(line: ParsedLine, index: number): Access | undefined {
  const mnemonic = canonicalMnemonic(line);
  if (!mnemonic) return undefined;

  if (mnemonic === "move" || mnemonic === "movea")
    return index === 0
      ? "read"
      : mnemonic === "move" && index === 1
        ? "write"
        : undefined;
  if (["cmp", "cmpa", "tst", "btst"].includes(mnemonic)) return "read";
  if (["clr", "not", "neg", "negx", "nbcd", "tas"].includes(mnemonic))
    return index === 0 ? "readwrite" : undefined;
  if (["bchg", "bclr", "bset"].includes(mnemonic))
    return index === 1 ? "readwrite" : undefined;
  if (["add", "adda", "sub", "suba", "and", "or", "eor"].includes(mnemonic))
    return index === 0 ? "read" : index === 1 ? "readwrite" : undefined;
  return undefined;
}

function violates(expected: RegisterAccess, actual: Access): boolean {
  return expected === "read-only" ? actual !== "read" : actual !== "write";
}

export const amigaCustomRegisterAccess: Rule = {
  meta: {
    id: "correctness/amiga-custom-register-access",
    category: "correctness",
    defaultSeverity: "warning",
    platforms: ["amiga"],
    description: "Check read/write direction for Amiga custom-chip registers",
    tags: ["amiga", "hardware", "custom-registers"],
    docs: {
      source: "Amiga Hardware Reference Manual",
      note: "Custom-chip registers are read-only or write-only and must be accessed using the documented direction. A displacement written with a register's include name, as in `bltamod(a6)`, identifies that register even when the base register's value is not known.",
    },
  },
  checkLine(ctx, line, lineIndex) {
    for (let index = 0; index < (line.operands?.length ?? 0); index++) {
      const op = operand(line, index);
      const address = amigaEffectiveAddress(ctx, op, lineIndex);
      if (address === undefined) continue;
      const register = amigaCustomRegisters.get(address);
      if (!register) continue;
      const access = operandAccess(line, index);
      if (!access || !violates(register.access, access)) continue;

      const action =
        access === "read"
          ? "read"
          : access === "write"
            ? "write"
            : "read/modify/write";
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message: `${action} access to ${register.access} Amiga register ${register.name}`,
        loc: op?.loc ?? line.mnemonic!.loc,
        notes: [
          {
            message: `${register.name} at ${hex(address)} is documented as ${register.access}.`,
          },
        ],
      });
    }
  },
};

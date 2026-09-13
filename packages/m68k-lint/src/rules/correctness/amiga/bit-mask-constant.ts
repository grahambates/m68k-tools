import type { ExpressionNode, ParsedLine } from "m68k-parser";
import type { RuleContext } from "../../../core/context.js";
import type { Rule } from "../../../core/rule.js";
import { semanticMnemonic } from "../../../semantics/mnemonics.js";
import { operand } from "../../../util/ast.js";
import { replaceOperandInLine } from "../../optimization/helpers.js";
import { amigaEffectiveAddress } from "./custom-register-access.js";

type Family = "dma" | "int";
type Kind = "bit" | "mask";

interface ConstantUse {
  name: string;
  family: Family;
  kind: Kind;
}

const FAMILY_LABEL: Record<Family, string> = { dma: "DMA", int: "interrupt" };
const PREFIX: Record<Family, Record<Kind, string>> = {
  dma: { bit: "DMAB_", mask: "DMAF_" },
  int: { bit: "INTB_", mask: "INTF_" },
};

/**
 * `DMAB_*`/`INTB_*` are bit numbers for BTST and friends; `DMAF_*`/`INTF_*` are
 * the corresponding masks written to the register. The names differ by one
 * letter, so an editor completion picks the wrong one easily and the value is
 * silently wrong rather than rejected.
 *
 * Classification is by name alone, so this works without the include files.
 */
function classify(name: string): ConstantUse | undefined {
  const match = /^(DMA|INT)([BF])_/i.exec(name);
  if (!match) return undefined;
  return {
    name,
    family: match[1].toLowerCase() === "dma" ? "dma" : "int",
    kind: match[2].toLowerCase() === "b" ? "bit" : "mask",
  };
}

function collectConstants(
  expr: ExpressionNode,
  found: ConstantUse[] = [],
): ConstantUse[] {
  switch (expr.type) {
    case "symbol": {
      const use = classify(expr.name);
      if (use) found.push(use);
      return found;
    }
    case "group":
      return collectConstants(expr.expression, found);
    case "unary-op":
      return collectConstants(expr.operand, found);
    case "binary-op":
      collectConstants(expr.left, found);
      return collectConstants(expr.right, found);
    default:
      return found;
  }
}

const BIT_INSTRUCTIONS = new Set(["btst", "bset", "bclr", "bchg"]);

/** Registers whose value is built from these constants, and which family they take. */
const REGISTER_FAMILY = new Map<number, { name: string; family: Family }>([
  [0xdff002, { name: "DMACONR", family: "dma" }],
  [0xdff096, { name: "DMACON", family: "dma" }],
  [0xdff01c, { name: "INTENAR", family: "int" }],
  [0xdff01e, { name: "INTREQR", family: "int" }],
  [0xdff09a, { name: "INTENA", family: "int" }],
  [0xdff09c, { name: "INTREQ", family: "int" }],
]);

/**
 * The target register of a bit or value operation, if it is one of these.
 * A byte access to the low half is spelled `intreqr+1(a6)`, so an address one
 * past a register still names that register.
 */
function targetRegister(ctx: RuleContext, line: ParsedLine, index: number) {
  for (const operandIndex of [1, 0]) {
    const address = amigaEffectiveAddress(
      ctx,
      operand(line, operandIndex),
      index,
    );
    if (address === undefined) continue;
    const register =
      REGISTER_FAMILY.get(address) ?? REGISTER_FAMILY.get(address - 1);
    if (register) return register;
  }
  return undefined;
}

function rename(text: string, from: ConstantUse, to: Kind): string {
  const wanted = PREFIX[from.family][to];
  return text.replace(
    new RegExp(`\\b${from.name}\\b`, "g"),
    wanted + from.name.slice(from.name.indexOf("_") + 1),
  );
}

export const amigaBitMaskConstants: Rule = {
  meta: {
    id: "correctness/amiga-bit-mask-constant",
    category: "correctness",
    defaultSeverity: "warning",
    platforms: ["amiga"],
    description:
      "Flag DMAB_/INTB_ bit numbers used where DMAF_/INTF_ masks are required, and the reverse",
    tags: ["amiga", "dmacon", "intena", "constants", "likely-typo"],
    docs: {
      note: "DMAB_*/INTB_* are bit numbers for BTST/BSET/BCLR/BCHG; DMAF_*/INTF_* are the masks written to DMACON, INTENA and INTREQ. The names differ by one letter, so the wrong one is easy to complete and produces a silently wrong value.",
    },
  },

  checkLine(ctx, line, index) {
    const mnemonic = semanticMnemonic(line);
    if (!mnemonic) return;

    for (let i = 0; i < (line.operands?.length ?? 0); i++) {
      const op = operand(line, i);
      if (op?.type !== "immediate" || op.value.type === "string-literal")
        continue;
      const uses = collectConstants(op.value);
      if (!uses.length) continue;

      const register = targetRegister(ctx, line, index);
      const isBitNumber = BIT_INSTRUCTIONS.has(mnemonic) && i === 0;

      // Expected kind, in order of confidence: the instruction form, then the
      // fact that a value written to one of these registers is a mask, then the
      // majority within the expression itself.
      let expectedKind: Kind | undefined;
      if (isBitNumber) expectedKind = "bit";
      else if (register) expectedKind = "mask";
      else {
        const masks = uses.filter((use) => use.kind === "mask").length;
        if (masks !== 0 && masks !== uses.length)
          expectedKind = masks * 2 > uses.length ? "mask" : "bit";
      }
      if (!expectedKind) continue;

      const expectedFamily = register?.family;
      const wrong = uses.filter(
        (use) =>
          use.kind !== expectedKind ||
          (expectedFamily !== undefined && use.family !== expectedFamily),
      );
      if (!wrong.length) continue;

      // Only offer a rewrite when every wrong constant just has the wrong
      // letter. A cross-family mistake has no mechanical correction: there is no
      // DMA equivalent of an interrupt name.
      const original = ctx
        .sourceLine((line.lineNumber ?? 1) - 1)
        ?.slice(op.loc.start, op.loc.end);
      const renameable =
        expectedFamily === undefined ||
        wrong.every((use) => use.family === expectedFamily);
      let replacement: string | undefined;
      if (original !== undefined && renameable) {
        let corrected = original;
        for (const use of wrong)
          corrected = rename(corrected, use, expectedKind);
        replacement = replaceOperandInLine(ctx, line, i, corrected);
      }

      const names = wrong.map((use) => use.name).join(", ");
      const wanted = PREFIX[expectedFamily ?? wrong[0].family][expectedKind];
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: register || isBitNumber ? "certain" : "high",
        message: register
          ? `${names} used with ${register.name}, which takes ${FAMILY_LABEL[register.family]} ${expectedKind === "bit" ? "bit numbers" : "masks"} (${wanted}*)`
          : `${names} ${wrong.length === 1 ? "does" : "do"} not match the ${expectedKind === "bit" ? "bit number" : "mask"} constants used alongside ${wrong.length === 1 ? "it" : "them"} (${wanted}*)`,
        loc: op.loc ?? line.mnemonic!.loc,
        notes: [
          {
            message:
              expectedKind === "bit"
                ? "BTST/BSET/BCLR/BCHG take a bit number, so the B form is required; the F form is a mask and would select the wrong bit."
                : "A value written to this register is a mask, so the F form is required; the B form is a bit number and would set the wrong bits.",
          },
        ],
        suggestion: replacement
          ? {
              description: `Use ${wanted}${wrong.length === 1 ? wrong[0].name.slice(wrong[0].name.indexOf("_") + 1) : "* forms"}`,
              replacement,
              applicability: "safe",
            }
          : undefined,
        data: { wrong: names, expectedKind, expectedFamily },
      });
    }
  },
};

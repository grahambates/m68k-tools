import type { ParsedLine } from "m68k-parser";
import type { RuleContext } from "../../core/context.js";
import type { Rule } from "../../core/rule.js";
import { scanBlocks } from "../../analysis/blocks.js";
import {
  conditionCode,
  flagsReadByCondition,
  getFlagSemantics,
} from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { instructionSize } from "../../util/ast.js";

interface Codes {
  N: boolean;
  Z: boolean;
  V: boolean;
  C: boolean;
}

function holds(condition: string, f: Codes): boolean {
  switch (condition) {
    case "hi":
      return !f.C && !f.Z;
    case "ls":
      return f.C || f.Z;
    case "cc":
    case "hs":
      return !f.C;
    case "cs":
    case "lo":
      return f.C;
    case "ne":
      return !f.Z;
    case "eq":
      return f.Z;
    case "vc":
      return !f.V;
    case "vs":
      return f.V;
    case "pl":
      return !f.N;
    case "mi":
      return f.N;
    case "ge":
      return f.N === f.V;
    case "lt":
      return f.N !== f.V;
    case "gt":
      return !f.Z && f.N === f.V;
    default:
      return f.Z || f.N !== f.V;
  }
}

const BITS: Readonly<Record<string, number | undefined>> = {
  b: 8,
  w: 16,
  l: 32,
};

/** N and Z for a result, as the instruction sets them. */
function result(value: bigint, bits: number): Pick<Codes, "N" | "Z"> {
  const mask = (1n << BigInt(bits)) - 1n;
  const masked = value & mask;
  return { N: ((masked >> BigInt(bits - 1)) & 1n) === 1n, Z: masked === 0n };
}

/**
 * The condition codes an instruction leaves, when they follow from values
 * known at that point, or undefined when they do not.
 */
function codesAfter(ctx: RuleContext, index: number): Codes | undefined {
  const line = ctx.line(index);
  if (line?.mnemonic?.type !== "instruction") return undefined;
  const mnemonic = semanticMnemonic(line);
  const size = instructionSize(line);

  // A source operand's value, as an unsigned pattern of the operation's width.
  const valueOf = (op: ParsedLine["operands"], at: number, bits: number) => {
    const node = op?.[at];
    let value: number | undefined;
    if (node?.type === "immediate" && node.value.type !== "string-literal") {
      const known = ctx.evaluate(node.value);
      value = known.known ? known.value : undefined;
    } else if (
      node?.type === "data-register" ||
      node?.type === "address-register"
    ) {
      value = ctx.registers.knownConstantBefore(index, node.register);
    }
    if (value === undefined) return undefined;
    return BigInt.asUintN(bits, BigInt(value));
  };

  switch (mnemonic) {
    case "moveq": {
      const source = valueOf(line.operands, 0, 8);
      if (source === undefined) return undefined;
      const value = BigInt.asIntN(8, source);
      return { ...result(value, 32), V: false, C: false };
    }
    case "clr":
      return { N: false, Z: true, V: false, C: false };
    case "move":
    case "tst": {
      const width = size && BITS[size];
      if (!width) return undefined;
      const value = valueOf(line.operands, 0, width);
      if (value === undefined) return undefined;
      return { ...result(value, width), V: false, C: false };
    }
    case "cmp":
    case "cmpi":
    case "cmpa": {
      const width = size && BITS[size];
      if (!width) return undefined;
      const address = mnemonic === "cmpa";
      const bits = address ? 32 : width;
      let src = valueOf(line.operands, 0, width);
      const dst = valueOf(line.operands, 1, bits);
      if (src === undefined || dst === undefined) return undefined;
      // CMPA sign-extends a word source to the full register.
      if (address) src = BigInt.asUintN(32, BigInt.asIntN(width, src));
      const mask = (1n << BigInt(bits)) - 1n;
      const diff = (dst - src) & mask;
      const top = 1n << BigInt(bits - 1);
      return {
        ...result(diff, bits),
        V: ((dst ^ src) & (dst ^ diff) & top) !== 0n,
        C: src > dst,
      };
    }
    default:
      return undefined;
  }
}

/**
 * A conditional branch or Scc whose outcome never varies.
 *
 * Follows the condition codes back to the instruction that set them and works
 * out what it left, from values the register analysis knows. Reports only when
 * every reaching definition is understood and they all give the same answer.
 * An always-taken branch is usually a comparison against the wrong register or
 * a stale value; a never-taken one is dead code.
 *
 * Deliberately limited to MOVEQ, MOVE, CLR, TST and CMP forms on registers and
 * immediates, whose flags follow directly from the operands. Anything else
 * leaves the answer unknown rather than guessed.
 */
export const constantCondition: Rule = {
  meta: {
    id: "suspicious/constant-condition",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a conditional branch or Scc whose outcome is known in advance",
    tags: ["flags", "control-flow", "dead-code"],
    docs: {
      note: "Works out the condition codes left by MOVEQ, MOVE, CLR, TST, CMP, CMPI and CMPA when their operands are known constants, and evaluates the branch against them. Never reported when any path to the branch sets the flags in a way that is not understood, or inside a macro body.",
    },
  },

  checkFile(ctx) {
    const blocks = scanBlocks(ctx.file);

    ctx.file.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "instruction") return;
      if (blocks.region[index] !== 0) return;
      const mnemonic = semanticMnemonic(line);
      if (!mnemonic) return;

      // Bcc and Scc only: DBcc has a counter as well, and BRA, BSR, ST and SF
      // have no condition to settle.
      const condition = conditionCode(mnemonic);
      if (!condition || condition === "t" || condition === "f") return;
      if (mnemonic.startsWith("db")) return;
      const branch =
        getFlagSemantics(line).controlFlow === "conditional-branch";
      if (!branch && !mnemonic.startsWith("s")) return;

      // Every flag the condition reads must come from the same instructions.
      let sources: number[] | undefined;
      for (const flag of flagsReadByCondition(mnemonic)) {
        const definitions = ctx.flags.reachingDefinitionsBefore(index, flag);
        if (definitions.length === 0) return;
        const indices: number[] = [];
        for (const definition of definitions) {
          if (definition.kind !== "instruction") return;
          indices.push(definition.index);
        }
        indices.sort((a, b) => a - b);
        if (sources && sources.join() !== indices.join()) return;
        sources = indices;
      }
      if (!sources) return;

      let outcome: boolean | undefined;
      for (const source of sources) {
        const codes = codesAfter(ctx, source);
        if (!codes) return;
        const taken = holds(condition, codes);
        if (outcome !== undefined && outcome !== taken) return;
        outcome = taken;
      }
      if (outcome === undefined || !line.mnemonic) return;

      const from = sources[0];
      const origin = ctx.sourceLine(from)?.trim();
      const name = line.mnemonic.instruction.toUpperCase();
      const where = `line ${ctx.line(from)?.lineNumber ?? from + 1}`;
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "high",
        message: branch
          ? `${name} is ${outcome ? "always" : "never"} taken: the condition codes are fixed by ${where}`
          : `${name} always sets its operand to ${outcome ? "$FF" : "$00"}: the condition codes are fixed by ${where}`,
        loc: line.mnemonic.loc,
        notes: [
          {
            message: `${origin ? `\`${origin}\` on ${where}` : where} leaves the same condition codes every time, since the values it uses are known here.`,
          },
        ],
        suggestion: {
          description: branch
            ? outcome
              ? "Replace with an unconditional branch, or check the comparison"
              : "Remove the branch, or check the comparison"
            : "Check the comparison",
          applicability: "manual",
        },
        data: { outcome },
      });
    });
  },
};

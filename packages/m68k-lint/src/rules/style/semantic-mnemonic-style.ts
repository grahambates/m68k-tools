import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";

function sourceMnemonic(line: ParsedLine): string | undefined {
  return line.mnemonic?.type === "instruction"
    ? line.mnemonic.instruction.toLowerCase()
    : undefined;
}

function replaceMnemonic(
  sourceLine: string,
  from: string,
  to: string,
): string | undefined {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  return pattern.test(sourceLine) ? sourceLine.replace(pattern, to) : undefined;
}

export const preferAddressRegisterMnemonics: Rule = {
  meta: {
    id: "style/prefer-address-register-mnemonics",
    category: "style",
    defaultSeverity: "info",
    enabledByDefault: false,
    presets: ["style"],
    description:
      "Prefer MOVEA/ADDA/SUBA/CMPA spellings when an address-register destination selects that semantic form",
    tags: ["style", "semantic-spelling", "address-register"],
  },
  checkLine(ctx, line, index) {
    if (line.mnemonic?.type !== "instruction") return;
    const source = sourceMnemonic(line);
    const semantic = semanticMnemonic(line);
    if (!source || !semantic) return;

    const preferred: Record<string, string> = {
      movea: "movea",
      adda: "adda",
      suba: "suba",
      cmpa: "cmpa",
    };
    const replacementMnemonic = preferred[semantic];
    if (!replacementMnemonic || source === replacementMnemonic) return;
    // Only rewrite generic source spellings. Immediate aliases such as ADDI are
    // assembler-specific enough that we leave them to their own style choices.
    if (!new Set(["move", "add", "sub", "cmp"]).has(source)) return;

    const replacement = replaceMnemonic(
      ctx.sourceLine(index) ?? "",
      line.mnemonic.instruction,
      replacementMnemonic,
    );
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Prefer explicit ${replacementMnemonic.toUpperCase()} spelling for address-register semantics`,
      loc: line.mnemonic.loc,
      notes: [
        {
          message:
            "This does not change the encoded instruction; it makes address-register width, sign-extension, and CCR semantics explicit.",
        },
      ],
      suggestion: replacement
        ? {
            description: `Use ${replacementMnemonic.toUpperCase()} spelling`,
            replacement,
            applicability: "safe",
          }
        : undefined,
    });
  },
};

function aliasRule(
  id: string,
  description: string,
  aliases: Readonly<Record<string, string>>,
): Rule {
  return {
    meta: {
      id,
      category: "style",
      defaultSeverity: "info",
      enabledByDefault: false,
      description,
      tags: ["style", "mnemonic-alias"],
    },
    checkLine(ctx, line, index) {
      if (line.mnemonic?.type !== "instruction") return;
      const source = sourceMnemonic(line);
      if (!source) return;
      const target = aliases[source];
      if (!target) return;
      const replacement = replaceMnemonic(
        ctx.sourceLine(index) ?? "",
        line.mnemonic.instruction,
        target,
      );
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message: `Prefer ${target.toUpperCase()} over equivalent alias ${source.toUpperCase()}`,
        loc: line.mnemonic.loc,
        suggestion: replacement
          ? {
              description: `Use ${target.toUpperCase()}`,
              replacement,
              applicability: "safe",
            }
          : undefined,
      });
    },
  };
}

export const preferDbraAlias = aliasRule(
  "style/prefer-dbra",
  "Prefer DBRA spelling over the equivalent DBF alias",
  {
    dbf: "dbra",
  },
);

export const preferDbfAlias = aliasRule(
  "style/prefer-dbf",
  "Prefer DBF spelling over the equivalent DBRA alias",
  {
    dbra: "dbf",
  },
);

export const preferUnsignedConditionAliases = aliasRule(
  "style/prefer-unsigned-condition-aliases",
  "Prefer HS/LO condition aliases where available (BHS/BLO, DBHS/DBLO, SHS/SLO)",
  {
    bcc: "bhs",
    bcs: "blo",
    dbcc: "dbhs",
    dbcs: "dblo",
    scc: "shs",
    scs: "slo",
  },
);

export const preferCarryConditionAliases = aliasRule(
  "style/prefer-carry-condition-aliases",
  "Prefer CC/CS condition aliases where available (BCC/BCS, DBCC/DBCS, SCC/SCS)",
  {
    bhs: "bcc",
    blo: "bcs",
    dbhs: "dbcc",
    dblo: "dbcs",
    shs: "scc",
    slo: "scs",
  },
);

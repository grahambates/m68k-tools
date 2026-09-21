import { parseFile } from "m68k-parser";
import { DefaultRuleContext } from "../core/context.js";
import { measureDiagnosticImpact } from "../analysis/impact.js";
import type { Processor } from "../core/config.js";
import type { OptimizationAssessment } from "../core/diagnostic.js";
import type { Rule } from "../core/rule.js";
import { defaultRules } from "../rules/index.js";

export interface RuleImpactAuditCase {
  ruleId: string;
  /** Optional label when a parameterized rule has multiple representative cases. */
  caseId?: string;
  source?: string;
  processor?: Processor;
  /** Explicit reason why this rule cannot be measured by the 68000 counter. */
  exempt?: string;
}

export interface RuleImpactAuditResult {
  ruleId: string;
  status:
    | "improvement"
    | "tradeoff"
    | "neutral"
    | "regression"
    | "partial"
    | "unmeasured"
    | "not-triggered"
    | "exempt"
    | "missing-case";
  source?: string;
  replacement?: string;
  assessment?: OptimizationAssessment;
  exempt?: string;
  detail?: string;
  sizeDelta?: number;
  cpuDelta?: number;
  readDelta?: number;
  writeDelta?: number;
}

// Representative examples are intentionally simple. They are not correctness
// proofs; correctness belongs to the normal rule tests. Their job is to make
// every mc68000 optimization rule prove that at least one representative
// replacement is actually an optimization according to 68kcounter.
export const ruleImpactAuditCases: readonly RuleImpactAuditCase[] = [
  { ruleId: "optimization/prefer-moveq", source: "move.l #42,d0" },
  { ruleId: "optimization/prefer-moveq-zero", source: "clr.l d0" },
  { ruleId: "optimization/prefer-addq", source: "add.l #4,d0" },
  { ruleId: "optimization/prefer-subq", source: "sub.l #4,d0" },
  { ruleId: "optimization/prefer-subq-negative-add", source: "add.l #-4,d0" },
  { ruleId: "optimization/prefer-addq-negative-sub", source: "sub.l #-4,d0" },
  { ruleId: "optimization/prefer-not", source: "eor.l #-1,d0" },
  { ruleId: "optimization/prefer-tst-zero", source: "cmp.l #0,d0" },
  { ruleId: "optimization/prefer-bset", source: "or.l #8,d0" },
  { ruleId: "optimization/prefer-bclr", source: "and.l #-9,d0" },
  { ruleId: "optimization/shift-to-clear", source: "lsl.b #8,d0\nmoveq #0,d7" },
  { ruleId: "optimization/prefer-lea-quick", source: "lea 4(a0),a0" },
  { ruleId: "optimization/address-add-to-lea", source: "adda.l #100,a0" },
  { ruleId: "optimization/address-sub-to-lea", source: "suba.l #100,a0" },
  { ruleId: "optimization/redundant-lea", source: "lea (a0),a0" },
  {
    ruleId: "optimization/redundant-zero-displacement",
    source: "move.l 0(a0),d0",
  },
  { ruleId: "optimization/prefer-add-for-shift-one", source: "lsl.w #1,d0" },
  // The inverse pair. Only one is live at a time, but both are measured so the
  // declared goal can be checked against what each actually costs.
  {
    ruleId: "optimization/adds-to-shift",
    source: "add.w d0,d0\nadd.w d0,d0\nmoveq #0,d7",
    processor: "mc68000",
  },
  { ruleId: "optimization/shift-two-adds", source: "lsl.w #2,d0" },
  {
    ruleId: "optimization/prefer-move-word-address",
    source: "move.l #1234,a0",
  },
  { ruleId: "optimization/zero-address-register", source: "move.l #0,a0" },
  { ruleId: "optimization/push-immediate-pea", source: "move.l #1234,-(sp)" },
  {
    ruleId: "optimization/push-address-pea",
    source: "move.l a0,-(sp)\nadd.l #12,(sp)\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/prefer-link-sequence",
    source: "move.l a6,-(sp)\nmove.l sp,a6\nadd.w #-16,sp",
  },
  {
    ruleId: "optimization/prefer-unlk-sequence",
    source: "move.l a6,sp\nmove.l (sp)+,a6",
  },
  { ruleId: "optimization/single-register-movem", source: "movem.l d0,-(sp)" },
  {
    ruleId: "optimization/bset-low-word-mask",
    source: "bset.l #8,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/bclr-low-word-mask",
    source: "bclr.l #8,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/bchg-low-word-mask",
    source: "bchg.l #8,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/known-zero-clear",
    source: "moveq #0,d7\nclr.l -(a0)\nmoveq #1,d7",
  },
  {
    ruleId: "optimization/move-immediate-via-scratch",
    source: "move.l #42,(a0)\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/cmp-zero-address-via-scratch",
    source: "cmp.l #0,a0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-consecutive-addq",
    caseId: "sum-in-quick-range",
    source: "addq.l #2,d0\naddq.l #3,d0",
  },
  {
    ruleId: "optimization/combine-address-adjustments",
    caseId: "lea-pair",
    source: "lea 32(a0),a0\nlea 32(a0),a0\nmove.l d0,(a0)",
  },
  {
    ruleId: "optimization/combine-address-adjustments",
    caseId: "quick-then-lea",
    source: "addq.l #4,a0\nlea 8(a0),a0\nmove.l d0,(a0)",
  },
  {
    ruleId: "optimization/combine-consecutive-shift",
    source: "lsl.w #2,d0\nlsl.w #6,d0",
  },
  {
    ruleId: "optimization/combine-consecutive-bit-ops",
    source: "bclr #0,d0\nbclr #4,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-loads-into-movem",
    source: "move.l (a0)+,d0\nmove.l (a0)+,d1\nmove.l (a0)+,d2\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/fold-redundant-intermediate",
    caseId: "into-arithmetic",
    source: "move.w (a0),d1\nadd.w d1,d0\nmoveq #0,d1",
  },
  {
    ruleId: "optimization/fold-redundant-intermediate",
    caseId: "into-move",
    source: "move.w (a0),d1\nmove.w d1,(a1)\nmoveq #0,d1",
  },
  { ruleId: "optimization/zero-store-to-clear", source: "move.w #0,$64(a6)" },
  {
    ruleId: "optimization/multiply-word-by-zero",
    source: "mulu.w #0,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/muls-word-by-one",
    source: "muls.w #1,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/mulu-word-by-one",
    source: "mulu.w #1,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/muls-word-power-of-two",
    source: "muls.w #8,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/mulu-word-power-of-two",
    source: "mulu.w #8,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/muls-word-high-power-of-two",
    source: "muls.w #512,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/mulu-word-high-power-of-two",
    source: "mulu.w #512,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/muls-word-selected-constants",
    source: "muls.w #10,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/negate-sub-to-add",
    source: "neg.l d0\nsub.l d0,d1\nmoveq #0,d0",
  },
  {
    ruleId: "optimization/negate-add-to-sub",
    source: "neg.l d0\nadd.l d0,d1\nmoveq #0,d0",
  },
  {
    ruleId: "optimization/negate-add-mask-to-eor",
    source: "moveq #3,d0\nneg.l d0\nadd.l #7,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/move-immediate-below-moveq",
    source: "move.l #-129,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/move-immediate-byte-complement",
    source: "move.l #200,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/move-immediate-double-byte",
    source: "move.l #200,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/move-immediate-word-complement",
    source: "move.l #65534,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/move-immediate-swap",
    source: "move.l #2752512,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/cancel-addq-predecrement-move",
    source: "addq.l #4,a0\nmove.l d0,-(a0)",
  },
  {
    ruleId: "optimization/cancel-subq-postincrement-move",
    source: "subq.l #4,a0\nmove.l (a0)+,d0",
  },
  {
    ruleId: "optimization/cancel-multiple-predecrement-moves",
    source: "addq.l #8,a0\nmove.l d0,-(a0)\nmove.l d1,-(a0)",
  },
  {
    ruleId: "optimization/zero-arithmetic-to-tst",
    source: "add.l #0,d0\nbeq .x\n.x:",
  },
  {
    ruleId: "optimization/redundant-tst",
    source: "move.w d0,d1\ntst.w d1\nbeq .x\n.x:",
  },
  { ruleId: "optimization/bset-to-tas", source: "bset.b #7,(a0)\nmoveq #0,d7" },
  { ruleId: "optimization/lea-zero-address", source: "lea 0.w,a0" },
  {
    ruleId: "optimization/long-shift-sequence",
    source: "lsl.l #16,d0\nmoveq #0,d7",
  },
  { ruleId: "optimization/movea-immediate-to-lea", source: "move.l #100,a0" },
  {
    ruleId: "optimization/movea-add-to-lea",
    source: "move.l a0,a1\nadd.l #12,a1",
  },
  {
    ruleId: "optimization/address-expression-to-lea",
    source: "move.l a0,a2\nadd.l #12,a2\nadd.l d3,a2",
  },
  {
    ruleId: "optimization/cancel-stack-pea-sequence",
    source: "addq.l #4,sp\npea (a0)\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/multiply-long-small-constant",
    exempt: "source MUL?.L form is not measurable by 68kcounter on 68000",
  },
  {
    ruleId: "optimization/multiply-long-large-power-of-two",
    exempt: "source MUL?.L form is not measurable by 68kcounter on 68000",
  },
  {
    ruleId: "optimization/narrow-movea-immediate-word",
    source: "movea.l #1234,a0",
  },
  {
    ruleId: "optimization/narrow-address-immediate-word",
    source: "adda.l #1234,a0",
  },
  {
    ruleId: "optimization/simplify-long-word-mask",
    source: "andi.l #$ffff0000,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/normalize-byte-rotate-direction",
    source: "rol.b #7,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/known-register-rotate",
    source: "moveq #12,d1\nrol.w d1,d0\nmoveq #0,d1",
  },
  { ruleId: "optimization/roxl-to-addx", source: "roxl.w #1,d0\nmoveq #0,d7" },
  { ruleId: "optimization/lsl-byte-seven", source: "lsl.b #7,d0\nmoveq #0,d7" },
  { ruleId: "optimization/asl-byte-seven", source: "asl.b #7,d0\nmoveq #0,d7" },
  {
    ruleId: "optimization/known-register-shift-to-clear",
    source: "moveq #32,d1\nlsl.l d1,d0\nmoveq #0,d1",
  },
  { ruleId: "optimization/lsr-byte-seven", source: "lsr.b #7,d0\nmoveq #0,d7" },
  {
    ruleId: "optimization/asr-byte-saturate",
    source: "asr.b #7,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/known-register-shift-reduction",
    source: "moveq #12,d1\nlsl.w d1,d0\nmoveq #0,d1",
  },
  {
    ruleId: "optimization/known-register-asr-word-low-only",
    source:
      "moveq #12,d1\nasr.w d1,d0\nmoveq #0,d1\nmove.w d0,d2\nmove.l #0,d0",
  },
  {
    ruleId: "optimization/known-register-asr-long-high",
    source: "moveq #28,d1\nasr.l d1,d0\nmoveq #0,d1",
  },
  {
    ruleId: "optimization/known-register-asr-saturate",
    source: "moveq #31,d1\nasr.l d1,d0\nmoveq #0,d1",
  },
  {
    ruleId: "optimization/address-arithmetic-indexed-lea",
    source: "adda.w #12,a0\nadda.l d1,a0",
  },
  {
    ruleId: "optimization/muls-word-full-result-constants",
    source: "muls.w #13,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/muls-word-low-word-only",
    source: "muls.w #9,d0\nmove.w d0,d2\nmove.l #0,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/mulu-word-low-word-only",
    source: "mulu.w #9,d0\nmove.w d0,d2\nmove.l #0,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/muls-word-full-result-constants",
    caseId: "generated-63",
    source: "muls.w #63,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/muls-word-low-word-only",
    caseId: "generated-40",
    source: "muls.w #40,d0\nmove.w d0,d2\nmove.l #0,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/mulu-word-low-word-only",
    caseId: "generated-100",
    source: "mulu.w #100,d0\nmove.w d0,d2\nmove.l #0,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/divu-word-by-constant",
    source: "divu.w #10,d0\nmove.w d0,d2\nmove.l #0,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/move-byte-and-mask",
    source: "move.b (a0),d0\nandi.b #$7f,d0\nmove.b d0,d1\nmove.l #0,d0",
  },
  {
    ruleId: "optimization/stack-word-shift-eight",
    source: "lsl.w #8,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/stack-known-register-shift",
    source: "moveq #24,d1\nlsr.l d1,d0\nmoveq #0,d1\nmoveq #0,d7",
  },
  { ruleId: "optimization/andi-all-ones-to-tst", source: "andi.l #-1,d0" },
  { ruleId: "optimization/ori-zero-to-tst", source: "ori.l #0,d0" },
  { ruleId: "optimization/eori-zero-to-tst", source: "eori.l #0,d0" },
  {
    ruleId: "optimization/compare-long-immediate-via-moveq",
    source: "cmp.l #42,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/destructive-small-compare-branch",
    source:
      "cmp.w #3,d0\nbne alt\nmoveq #0,d0\naddq.l #1,d1\nbra done\nalt:\nmoveq #0,d0\naddq.l #1,d1\ndone:\nnop",
  },
  {
    ruleId: "optimization/jsr-jmp-tail-dispatch",
    source: "jsr sub\njmp next\nsub:\nrts\nnext:\nrts",
  },
  {
    ruleId: "optimization/prefer-st-minus-one",
    source: "move.b #-1,(a0)\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/btst-sign-branch",
    source: "btst #7,d0\nbne .x\n.x:\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-adjacent-clr-bytes",
    source: "clr.b $1000\nclr.b $1001\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-adjacent-clr-words",
    source: "clr.w $1000\nclr.w $1002\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-adjacent-move-bytes",
    source: "move.b #1,$1000\nmove.b #2,$1001\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-adjacent-move-words",
    source: "move.w #1,$1000\nmove.w #2,$1002\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-adjacent-copy-bytes",
    source: "move.b (a0)+,(a1)+\nmove.b (a0)+,(a1)+\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/combine-adjacent-copy-words",
    source: "move.w (a0)+,(a1)+\nmove.w (a0)+,(a1)+\nmoveq #0,d7",
  },
  // The tail-call rewrites are offered now, so they can be measured. The
  // callee sees one fewer return address on the stack, which is a condition
  // stated on the suggestion rather than a reason to withhold it.
  {
    ruleId: "optimization/jsr-rts-tail-call",
    source: "jsr sub\nrts\nsub:\nrts",
  },
  {
    ruleId: "optimization/bsr-rts-tail-call",
    source: "bsr sub\nrts\nsub:\nrts",
  },
  { ruleId: "optimization/null-branch", source: "bra next\nnext:\nnop" },
  {
    ruleId: "optimization/mask-via-moveq",
    source: "move.l (a0),d0\nand.l #$3f,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/carry-to-mask-via-subx",
    source: "sub.l d2,d3\nscs d0\next.w d0\next.l d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/arithmetic-immediate-via-scratch",
    source: "add.l #20,d1\nmoveq #0,d0\nmove.l d1,d2",
  },
  {
    ruleId: "optimization/data-register-sign-bit-to-tas",
    caseId: "bset",
    source: "bset #7,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/data-register-sign-bit-to-tas",
    caseId: "ori",
    source: "ori.b #$80,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/fold-index-into-effective-address",
    source: "adda.w d4,a0\nmove.l (a0),a1\nlea buf,a0\nbuf:",
  },

  // No 68000 measurement is meaningful/available for these target-specific rules.
  {
    ruleId: "optimization/combine-ext-byte",
    exempt: "68020+-only; 68kcounter is 68000-only",
  },
  { ruleId: "optimization/cmpa-zero-to-tst-030", exempt: "68020+-only" },
  { ruleId: "optimization/multiply-long-by-one", exempt: "68020+-only" },
  { ruleId: "optimization/muls-long-060-simple", exempt: "68020+-only" },
  {
    ruleId: "optimization/divu-word-power-of-two",
    source:
      "move.l #100,d0\ndivu.w #4,d0\nmove.w d0,d1\nmove.l #0,d0\nmoveq #0,d7",
  },
  {
    ruleId: "optimization/divu-long-power-of-two",
    exempt: "68020+ long DIV form; 68kcounter is 68000-only",
  },
  {
    ruleId: "optimization/narrow-cmpa-immediate-word",
    exempt:
      "vasm provenance rule retained primarily for later CPU/address-form audit; duplicate 68000 coverage exists in address-width rules",
  },
  {
    ruleId: "optimization/negative-signed-multiply",
    exempt: "68020+ long MUL form; 68kcounter is 68000-only",
  },
  {
    ruleId: "optimization/unneeded-register-save",
    exempt:
      "manual-only suggestion with no replacement: it trims a register list across a whole routine, so there is no before/after instruction pair to measure",
  },
];

const casesByRule = new Map<string, RuleImpactAuditCase[]>();
for (const auditCase of ruleImpactAuditCases) {
  const cases = casesByRule.get(auditCase.ruleId) ?? [];
  cases.push(auditCase);
  casesByRule.set(auditCase.ruleId, cases);
}

/**
 * A label definition only counts as one while it starts in column 0. That is true
 * of both spellings: colon-terminated (`.loop:`, and `.loop: move.l d0,d1`) and
 * colon-less directive definitions (`answer equ 40+2`, `count set 3`, `base equr a3`).
 *
 * Indenting either does not demote it to an ordinary instruction line, it destroys
 * it: m68k-parser yields a line with neither a label nor a mnemonic, so branch
 * targets silently disappear and any rule that reasons about reachability sees a
 * different program from the one the fixture describes.
 */
const COLUMN_ZERO_DEFINITION =
  /^\S+(:|\s+(equ|equr|fequ|set|reg|rs\.[bwl]|=)\b)/i;

/**
 * m68k-parser follows traditional assembler column rules: a token beginning in
 * column 0 is eligible to be parsed as a label. Fixtures are stored in a compact
 * form, so indent every non-empty line before parsing, leaving column-zero label
 * definitions where they are.
 */
export function normalizeRuleImpactAuditSource(source: string): string {
  return source
    .split("\n")
    .map((line) =>
      line.trim().length === 0 ||
      /^[ \t]/.test(line) ||
      COLUMN_ZERO_DEFINITION.test(line)
        ? line
        : `\t${line}`,
    )
    .join("\n");
}

export function runRuleImpactAudit(
  rules: readonly Rule[] = defaultRules,
): RuleImpactAuditResult[] {
  const results: RuleImpactAuditResult[] = [];
  for (const rule of rules) {
    if (rule.meta.category !== "optimization") continue;
    const auditCases = casesByRule.get(rule.meta.id);
    if (!auditCases?.length) {
      results.push({ ruleId: rule.meta.id, status: "missing-case" });
      continue;
    }
    for (const auditCase of auditCases) {
      if (auditCase.exempt) {
        results.push({
          ruleId: rule.meta.id,
          status: "exempt",
          exempt: auditCase.exempt,
          detail: auditCase.caseId,
        });
        continue;
      }
      const rawSource = auditCase.source!;
      const source = normalizeRuleImpactAuditSource(rawSource);
      // Audit the rule directly. This deliberately bypasses normal rule enablement,
      // category, goal and output filtering: the purpose here is to validate the
      // rule's own representative transformation, not the lint orchestration.
      const file = parseFile(source);
      const config = {
        processors: [auditCase.processor ?? "mc68000"],
        goal: "balanced" as const,
        measureImpact: false,
      };
      const ctx = new DefaultRuleContext(file, source, config);
      if (rule.checkLine) {
        file.lines.forEach((line, index) => rule.checkLine?.(ctx, line, index));
      }
      rule.checkFile?.(ctx);
      const emitted = ctx
        .getDiagnostics()
        .find((d) => d.ruleId === rule.meta.id);
      if (!emitted) {
        const parseDetail = file.errors.length
          ? `parse errors: ${file.errors.map((error) => error.message).join(" | ")}`
          : `parsed: ${file.lines
              .map((line) => {
                const mnemonic =
                  line.mnemonic?.type === "instruction"
                    ? line.mnemonic.instruction
                    : (line.mnemonic?.type ?? "-");
                const operands =
                  line.operands?.map((operand) => operand.type).join(",") ?? "";
                return `${mnemonic}${operands ? ` [${operands}]` : ""}`;
              })
              .join("; ")}`;
        results.push({
          ruleId: rule.meta.id,
          status: "not-triggered",
          source,
          detail: `${auditCase.caseId ? `${auditCase.caseId}: ` : ""}${parseDetail}`,
        });
        continue;
      }
      const diagnostic = measureDiagnosticImpact(emitted, file, source, rule);
      const impact = diagnostic.suggestion?.impact;
      if (!impact?.assessment) {
        results.push({
          ruleId: rule.meta.id,
          status: "unmeasured",
          source,
          replacement: diagnostic.suggestion?.replacement,
          detail: auditCase.caseId,
        });
        continue;
      }
      const executionMeasured = impact.execution?.cpuCycles !== undefined;
      const onlyMeasuredRegressionIsSize =
        impact.assessment === "regression" &&
        impact.sizeBytes?.delta !== undefined &&
        impact.sizeBytes.delta > 0 &&
        !executionMeasured &&
        impact.execution?.readCycles === undefined &&
        impact.execution?.writeCycles === undefined;
      const auditStatus = onlyMeasuredRegressionIsSize
        ? ("partial" as const)
        : impact.assessment;
      results.push({
        ruleId: rule.meta.id,
        status: auditStatus,
        assessment: impact.assessment,
        source,
        replacement: diagnostic.suggestion?.replacement,
        sizeDelta: impact.sizeBytes?.delta,
        cpuDelta: impact.execution?.cpuCycles?.delta,
        readDelta: impact.execution?.readCycles?.delta,
        writeDelta: impact.execution?.writeCycles?.delta,
        detail: auditCase.caseId,
      });
    }
  }
  return results;
}
